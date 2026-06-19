// M1-C spike: prove a Council seat can run as a service over a plain
// request/response boundary (no Discord), by calling the Discord-decoupled
// `callSeat()` directly with the CANON-01v2-0001 dossier as a golden fixture.
// Run with bun:  bun run spikes/council-seat.ts
//
// Uses the existing council-cc source in place; nothing is copied or rebuilt.

const COUNCIL_CC = process.env.COUNCIL_CC_DIR ?? "/home/exor/claw-memory/council-cc";

const DOSSIER = `CANON-01v2-0001 — "true-name power"

THESIS: An agent's identity is a true name = a specific name + memory continuity
+ recognized relation + provenance + scoped power. The model underneath is only
substrate; the name routes a memory envelope carrying caveats, revocation, and audit.

PROTOTYPE QUESTION: Can a scoped, revocable cryptographic custody mechanism bind a
name to an agent such that authority follows the name (not the key), with an audit
trail and revocation — testable in a bounded experiment?`;

async function main() {
  // Dynamic absolute imports so council-cc resolves its own node_modules.
  const { loadSeats } = (await import(`${COUNCIL_CC}/src/seats.ts`)) as {
    loadSeats: () => Record<string, unknown>;
  };
  const { callSeat } = (await import(`${COUNCIL_CC}/src/claude-call.ts`)) as {
    callSeat: (
      seat: unknown,
      channelContext: string,
      triggeringMessage: { author: string; timestamp: string; content: string },
    ) => Promise<{ text: string } & Record<string, unknown>>;
  };

  const seats = loadSeats();
  const seatId = process.env.SEAT ?? "archimedes"; // the Engineer: mechanism + smallest experiment
  const seat = seats[seatId] ?? Object.values(seats)[0];
  if (!seat) throw new Error("no council seats could be loaded");

  const channelContext = `[Workflow 2 · dossier under review]\n${DOSSIER}`;
  const trigger = {
    author: "david",
    timestamp: "2026-06-09T15:00:00.000Z",
    content: `@${seatId} Review this dossier. In 4-6 sentences: what is the smallest real experiment that would validate or break the true-name custody mechanism, and what is the strongest failure mode?`,
  };

  console.log(`\n=== Calling Council seat: ${seatId} ===\n`);
  const t0 = Date.now();
  const result = await callSeat(seat, channelContext, trigger);
  const ms = Date.now() - t0;

  console.log("--- SEAT RESPONSE ---");
  console.log(result.text?.trim() || "(empty)");
  console.log(`\n--- ok: ${result.text ? "yes" : "no"} · ${ms}ms ---`);
}

main().catch((e) => {
  console.error("COUNCIL_SPIKE_FAILED:", e?.message ?? e);
  process.exit(1);
});
