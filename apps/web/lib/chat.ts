// Chat client for the gateway's /api/chat SSE stream. Mirrors the gateway's
// ChatFrame protocol (services/gateway/src/chat/frames.ts) the same way
// GraphHit is mirrored.
import { GATEWAY_URL, authHeaders } from "./gateway";
import { readActiveAgentPassportId } from "./passport-selection";

export type PaidAction = "council_quick" | "council_panel";

export type ChatFrame =
  | { type: "text"; delta: string }
  | { type: "tool_start"; name: string; args: unknown }
  | { type: "tool_result"; name: string; payload: unknown }
  | {
      type: "identity_kernel";
      enforced: true;
      agent_id: string;
      passport_id: string;
      receipts: Array<{ stage: string; hash: string; agent_id: string; passport_id: string; verdict: string; reason: string }>;
    }
  | { type: "confirm_required"; action: PaidAction; price: string; tool_use_id: string; args: { idea: string; seat?: string } }
  | { type: "assistant_message"; content: unknown[] }
  | { type: "usage"; in: number; out: number; cache_read?: number; cache_write?: number }
  | { type: "free"; remaining: number }
  | { type: "compaction"; summary: string; throughCount: number }
  | { type: "error"; message: string }
  | { type: "done"; pending?: boolean };

export type ChatMessage = { role: "user" | "assistant"; content: unknown };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * POST the history to /api/chat and parse the SSE stream into frames.
 * fetchImpl should be the x402-wrapped fetch when the gateway is metered.
 */
export async function sendChat(opts: {
  messages: ChatMessage[];
  /** Running summary cached from a prior compaction frame (replayed to the gateway). */
  summary?: string;
  /** ERC-8004 Agent Passport id bound by the gateway Identity Kernel when chat enforcement is enabled. */
  passportId?: string;
  /** Pins the Hermes ACP session so the real agent keeps per-conversation memory. */
  conversationId?: string;
  onFrame: (f: ChatFrame) => void;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}): Promise<void> {
  const doFetch: FetchLike = opts.fetchImpl ?? fetch;
  const passportId = opts.passportId ?? readActiveAgentPassportId() ?? process.env.NEXT_PUBLIC_LEONARDO_AGENT_PASSPORT_ID ?? "6960";

  // Session token unlocks the free prompts; the gateway verifies its HMAC.
  // Recover it from the session cookie whenever it's missing (older sign-ins,
  // stale tabs, cleared storage).
  async function recoverSession(): Promise<string | null> {
    try {
      const r = await fetch("/api/auth/token");
      if (!r.ok) return null;
      const j = (await r.json()) as { ok?: boolean; token?: string };
      if (j.ok && j.token) {
        localStorage.setItem("leo_session", j.token);
        return j.token;
      }
    } catch {
      // fall through
    }
    return null;
  }

  let session = typeof localStorage !== "undefined" ? localStorage.getItem("leo_session") : null;
  session ??= await recoverSession();

  const post = (sess: string | null) =>
    doFetch(`${GATEWAY_URL}/api/chat`, {
      method: "POST",
      headers: authHeaders({
        "content-type": "application/json",
        ...(sess ? { "x-leo-session": sess } : {}),
      }),
      body: JSON.stringify({
        messages: opts.messages,
        passport_id: passportId,
        ...(opts.summary ? { summary: opts.summary } : {}),
        ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
      }),
      signal: opts.signal,
    } as RequestInit);

  let res: Response;
  try {
    res = await post(session);
    // Paywalled without a session? Recover the token and retry exactly once —
    // covers stale tabs/bundles where the token never made it to storage.
    if (res.status === 402 && !session) {
      const recovered = await recoverSession();
      if (recovered) res = await post(recovered);
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (/insufficient|payment|402|usdc/i.test(m)) {
      throw new Error("Payment failed — make sure your wallet is on Base Sepolia with a little test USDC.");
    }
    throw new Error("Can't reach Leonardo right now.");
  }
  if (res.status === 402) {
    throw new Error(
      "Out of free prompts (or session expired) — each message costs ~2¢ in test USDC on Base Sepolia. Signing out and back in refreshes your session.",
    );
  }
  if (res.status === 503) throw new Error("Leonardo's chat brain isn't switched on yet.");
  if (!res.ok || !res.body) throw new Error(`Gateway error (${res.status}).`);

  await parseSSE(res.body, opts.onFrame);
}

/** Parse an SSE byte stream into ChatFrames (chunk-boundary-safe, skips comments). */
export async function parseSSE(body: ReadableStream<Uint8Array>, onFrame: (f: ChatFrame) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const event = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of event.split("\n")) {
        if (!line.startsWith("data: ")) continue; // skips ": ping" comments
        try {
          onFrame(JSON.parse(line.slice(6)) as ChatFrame);
        } catch {
          // malformed line — skip rather than kill the stream
        }
      }
    }
  }
}

/** Fold a streamed assistant turn (plain text) into API-shaped history. */
export function appendAssistantText(history: ChatMessage[], text: string): ChatMessage[] {
  return text.trim() ? [...history, { role: "assistant", content: text }] : history;
}

/** After a paid tool ran (or was declined), append the exact assistant turn + the tool_result. */
export function appendToolRound(
  history: ChatMessage[],
  assistantContent: unknown[],
  toolUseId: string,
  result: unknown,
  isError = false,
): ChatMessage[] {
  return [
    ...history,
    { role: "assistant", content: assistantContent },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: typeof result === "string" ? result : JSON.stringify(result),
          ...(isError ? { is_error: true } : {}),
        },
      ],
    },
  ];
}
