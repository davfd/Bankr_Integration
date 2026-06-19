// Context compaction: when a conversation grows past a soft budget, summarize
// the older turns into a running summary instead of dropping them (the old
// behaviour silently lost the head of long chats). The summary is produced by
// the same brain, emitted to the client as a `compaction` frame, cached there,
// and replayed as `priorSummary` next turn — so it isn't recomputed every turn.
import type { AnthropicLike, ChatMessage } from "./agent";

// Soft thresholds sit BELOW the hard clamp (40 msgs / 24K chars) so we compact
// before the clamp would start dropping turns.
export const SOFT_MAX_MESSAGES = 24;
export const SOFT_MAX_CHARS = 18_000;
export const KEEP_RECENT = 12; // most-recent turns kept verbatim
const SUMMARY_MAX_CHARS = 1800;
const SUMMARY_PREFIX = "Summary of the earlier conversation (compacted):\n";

const size = (arr: unknown) => JSON.stringify(arr).length;

/** True when the history is long enough to be worth compacting. */
export function needsCompaction(messages: ChatMessage[]): boolean {
  return messages.length > SOFT_MAX_MESSAGES || size(messages) > SOFT_MAX_CHARS;
}

/** Split into the overflow prefix to summarize and the recent turns to keep verbatim. */
export function splitForCompaction(messages: ChatMessage[], keepRecent = KEEP_RECENT): {
  overflow: ChatMessage[];
  recent: ChatMessage[];
} {
  if (messages.length <= keepRecent) return { overflow: [], recent: messages };
  return { overflow: messages.slice(0, messages.length - keepRecent), recent: messages.slice(-keepRecent) };
}

/** Flatten a turn (incl. tool_use / tool_result blocks) to compact text for the summarizer. */
function flatten(m: ChatMessage): string {
  const role = m.role === "assistant" ? "Leonardo" : "User";
  if (typeof m.content === "string") return `${role}: ${m.content}`;
  if (!Array.isArray(m.content)) return `${role}: ${JSON.stringify(m.content).slice(0, 400)}`;
  const parts: string[] = [];
  for (const b of m.content as Array<Record<string, unknown>>) {
    if (b?.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (b?.type === "tool_use") parts.push(`[called ${String(b.name)} ${JSON.stringify(b.input ?? {}).slice(0, 200)}]`);
    else if (b?.type === "tool_result") parts.push(`[tool result: ${String(b.content ?? "").slice(0, 400)}]`);
  }
  return `${role}: ${parts.join(" ")}`;
}

/**
 * Fold priorSummary + the overflow turns into a single tight running summary.
 * One brain call over the injected AnthropicLike client (so tests script it).
 */
export async function summarizeOverflow(opts: {
  client: AnthropicLike;
  model: string;
  priorSummary?: string;
  overflow: ChatMessage[];
}): Promise<string> {
  const transcript = opts.overflow.map(flatten).join("\n").slice(0, 16_000);
  const instruction =
    "You are compacting a conversation between a user and Leonardo (an inventor's assistant wired to an imagination graph, a Council, and a Workshop). " +
    "Rewrite the material below into a tight running summary the assistant can rely on to continue seamlessly. " +
    "Preserve: facts and figures established, decisions made, the user's goals and constraints, named concepts and any graph/Council findings cited, prices quoted, and open threads. " +
    "Drop pleasantries and process chatter. Write in compact prose or terse bullets, under 250 words. Output ONLY the summary.";
  const body =
    (opts.priorSummary ? `Existing summary so far:\n${opts.priorSummary}\n\n` : "") +
    `New conversation turns to fold in:\n${transcript}`;

  const stream = opts.client.messages.stream({
    model: opts.model,
    max_tokens: 700,
    system: [{ type: "text", text: instruction }],
    messages: [{ role: "user", content: body }],
  });
  // Drain deltas (some adapters only resolve finalMessage after iteration).
  for await (const _ of stream) {
    void _;
  }
  const final = await stream.finalMessage();
  const text = (final.content ?? [])
    .filter((b) => (b as { type?: string }).type === "text")
    .map((b) => String((b as { text?: string }).text ?? ""))
    .join("")
    .trim();
  return text.slice(0, SUMMARY_MAX_CHARS);
}

/** Build the working history from a running summary + the recent verbatim turns. */
export function buildWorkingWithSummary(summary: string, recent: ChatMessage[]): ChatMessage[] {
  if (!summary) return recent;
  const first = recent[0];
  // Merge into the first recent user turn when it's plain text — keeps clean
  // user/assistant alternation; otherwise prepend a standalone user turn.
  if (first && first.role === "user" && typeof first.content === "string") {
    return [{ role: "user", content: `${SUMMARY_PREFIX}${summary}\n\n---\n\n${first.content}` }, ...recent.slice(1)];
  }
  return [{ role: "user", content: `${SUMMARY_PREFIX}${summary}` }, ...recent];
}
