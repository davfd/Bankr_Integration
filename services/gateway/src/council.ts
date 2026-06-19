// Council-as-a-service: run a real council-cc seat behind a function boundary.
// Injected into the gateway so tests can mock it (no LLM in CI); the real
// implementation runs under bun, importing council-cc's Discord-decoupled
// callSeat() in place. Spends model tokens — never invoked by the test suite.

export type CouncilReview = { seat: string; verdict: string; ms: number };
export type CouncilReviewer = (input: { idea: string; seat?: string }) => Promise<CouncilReview>;

export type SeatVerdict = { seat: string; verdict: string; ms: number };
export type CouncilPanel = { verdicts: SeatVerdict[]; synthesis: string; ms: number };
export type CouncilPanelReviewer = (input: { idea: string }) => Promise<CouncilPanel>;

const REVIEW_PROMPT =
  "Review this dossier. In 4–6 sentences: the smallest real experiment that would validate or break it, and the strongest failure mode.";

const SEAT_TIMEOUT_MS = Number(process.env.COUNCIL_SEAT_TIMEOUT_MS ?? 75_000);
const SYNTH_TIMEOUT_MS = Number(process.env.COUNCIL_SYNTH_TIMEOUT_MS ?? 35_000);

/** Bound a seat call so a slow/hung seat can't stall the whole panel. */
function withTimeout(p: Promise<{ text?: string }>, ms: number): Promise<{ text?: string }> {
  return Promise.race([
    p,
    new Promise<{ text?: string }>((resolve) =>
      setTimeout(() => resolve({ text: "(this seat did not respond in time)" }), ms),
    ),
  ]);
}

async function loadCouncil() {
  const dir = process.env.COUNCIL_CC_DIR ?? "/home/exor/claw-memory/council-cc";
  const { loadSeats } = (await import(`${dir}/src/seats.ts`)) as {
    loadSeats: () => Record<string, unknown>;
  };
  const { callSeat } = (await import(`${dir}/src/claude-call.ts`)) as {
    callSeat: (
      s: unknown,
      ctx: string,
      t: { author: string; timestamp: string; content: string },
    ) => Promise<{ text?: string }>;
  };
  return { loadSeats, callSeat };
}

export const realCouncilReview: CouncilReviewer = async ({ idea, seat = "archimedes" }) => {
  const { loadSeats, callSeat } = await loadCouncil();
  const seats = loadSeats();
  const chosen = seats[seat] ?? Object.values(seats)[0];
  if (!chosen) throw new Error("no council seats available");

  const t0 = Date.now();
  const res = await callSeat(chosen, `[Workflow 2 · dossier under review]\n${idea}`, {
    author: "platform",
    timestamp: new Date().toISOString(),
    content: REVIEW_PROMPT,
  });
  return { seat, verdict: (res.text ?? "").trim(), ms: Date.now() - t0 };
};

/**
 * Full panel: every available seat reviews the dossier (in parallel), then one
 * seat synthesizes the verdicts into a single ruling. This is the real "five
 * critics" the dashboard advertises.
 */
export const realCouncilPanel: CouncilPanelReviewer = async ({ idea }) => {
  const { loadSeats, callSeat } = await loadCouncil();
  const seats = loadSeats();
  const entries = Object.entries(seats).filter(([, s]) => s);
  if (entries.length === 0) throw new Error("no council seats available");

  const t0 = Date.now();
  const ts = () => new Date().toISOString();

  const verdicts = await Promise.all(
    entries.map(async ([id, seat]) => {
      const s0 = Date.now();
      const res = await withTimeout(
        callSeat(seat, `[Workflow 2 · dossier under review]\n${idea}`, {
          author: "platform",
          timestamp: ts(),
          content: REVIEW_PROMPT,
        }),
        SEAT_TIMEOUT_MS,
      );
      return { seat: id, verdict: (res.text ?? "").trim(), ms: Date.now() - s0 };
    }),
  );

  // Synthesis pass: one seat reads all verdicts and renders a single ruling.
  const synthCtx =
    `[Workflow 2 · synthesis]\nDossier under review:\n${idea}\n\nThe seats returned:\n` +
    verdicts.map((v) => `## ${v.seat}\n${v.verdict}`).join("\n\n");
  const synthSeat = seats["kallimachos"] ?? entries[0]![1];
  const synth = await withTimeout(
    callSeat(synthSeat, synthCtx, {
      author: "platform",
      timestamp: ts(),
      content:
        "Synthesize the council into one ruling: ACCEPT / REVISE / REJECT, the decisive reason, and the single experiment that settles it. 4–6 sentences.",
    }),
    SYNTH_TIMEOUT_MS,
  );

  return { verdicts, synthesis: (synth.text ?? "").trim(), ms: Date.now() - t0 };
};
