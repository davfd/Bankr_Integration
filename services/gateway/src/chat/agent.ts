// The Leonardo chat agent loop: a stateless, streaming tool-use loop over the
// Anthropic SDK, yielding ChatFrames. Injectable at the SDK boundary so tests
// run a scripted mock (no network, no key).

import type { ChatFrame } from "./frames";
import { LEONARDO_SYSTEM } from "./persona";
import { CHAT_TOOLS, PAID_TOOLS, isPaidTool, dispatchFreeTool, type ChatToolDeps } from "./tools";
import { needsCompaction, splitForCompaction, summarizeOverflow, buildWorkingWithSummary } from "./compaction";

// ── SDK boundary (structural; the real client satisfies it) ─────────────────
type StreamEvent = {
  type: string;
  delta?: { type?: string; text?: string };
};
type FinalMessage = {
  content: Array<Record<string, unknown>>;
  stop_reason: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};
export type MessageStreamLike = AsyncIterable<StreamEvent> & {
  finalMessage(): Promise<FinalMessage>;
};
export type AnthropicLike = {
  messages: { stream(params: Record<string, unknown>): MessageStreamLike };
};

export type ChatMessage = { role: "user" | "assistant"; content: unknown };

// ── bounds ───────────────────────────────────────────────────────────────────
const MAX_MESSAGES = 40;
const MAX_HISTORY_CHARS = 24_000;
const MAX_TOOL_RESULT_CHARS = 8_000;
const MAX_TOOL_ITERATIONS = 4;

/**
 * Clamp client-held history: cap message count and total size, always keeping
 * the most recent turns. Returns null if the history is unusable.
 */
/** Keep only well-formed user/assistant turns (no slicing). Compaction sees this. */
export function validHistory(messages: unknown): ChatMessage[] | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const valid = messages.filter(
    (m): m is ChatMessage =>
      !!m && typeof m === "object" && ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant"),
  );
  return valid.length > 0 ? valid : null;
}

export function clampHistory(messages: unknown): ChatMessage[] | null {
  const valid = validHistory(messages);
  if (!valid) return null;

  let kept = valid.slice(-MAX_MESSAGES);
  // Trim oldest until under the char budget (always keep the last message).
  const size = (arr: ChatMessage[]) => JSON.stringify(arr).length;
  while (kept.length > 1 && size(kept) > MAX_HISTORY_CHARS) kept = kept.slice(1);
  // Client-supplied tool_results ride in user turns — bound each block.
  for (const m of kept) {
    if (Array.isArray(m.content)) {
      for (const block of m.content as Array<Record<string, unknown>>) {
        if (block?.type === "tool_result" && typeof block.content === "string" && block.content.length > MAX_TOOL_RESULT_CHARS) {
          block.content = (block.content as string).slice(0, MAX_TOOL_RESULT_CHARS) + " …(truncated)";
        }
      }
    }
  }
  // The API requires the first message to be a user turn.
  while (kept.length > 0 && kept[0]!.role !== "user") kept = kept.slice(1);
  return kept.length > 0 ? kept : null;
}

/** One chat turn: compact context if needed, stream text, run free tools inline, stop at paid tools. */
export async function* runChatTurn(opts: {
  client: AnthropicLike;
  model: string;
  messages: unknown;
  deps: ChatToolDeps;
  /** Running summary the client cached from a prior compaction frame. */
  priorSummary?: string;
}): AsyncGenerator<ChatFrame> {
  const all = validHistory(opts.messages);
  if (!all) {
    yield { type: "error", message: "No usable message history." };
    return;
  }

  // Context compaction: summarize the overflow instead of letting the hard clamp
  // silently drop it. Emit a `compaction` frame so the client caches the summary
  // and drops `throughCount` old messages (sending the summary back next turn).
  let prepared: ChatMessage[] = all;
  if (needsCompaction(all)) {
    const { overflow, recent } = splitForCompaction(all);
    if (overflow.length > 0) {
      let summary = opts.priorSummary ?? "";
      try {
        summary = await summarizeOverflow({ client: opts.client, model: opts.model, priorSummary: opts.priorSummary, overflow });
      } catch {
        summary = opts.priorSummary ?? ""; // summarizer hiccup → fall back to prior/clamp
      }
      if (summary) {
        yield { type: "compaction", summary, throughCount: overflow.length };
        prepared = buildWorkingWithSummary(summary, recent);
      }
    }
  }

  const history = clampHistory(prepared); // hard backstop (size caps, first-user, tool_result trim)
  if (!history) {
    yield { type: "error", message: "No usable message history." };
    return;
  }

  const working: Array<Record<string, unknown>> = history.map((m) => ({ role: m.role, content: m.content }));
  const usage = { in: 0, out: 0, cache_read: 0, cache_write: 0 };

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const stream = opts.client.messages.stream({
        model: opts.model,
        max_tokens: 4096,
        system: [{ type: "text", text: LEONARDO_SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: CHAT_TOOLS,
        thinking: { type: "adaptive" },
        messages: working,
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
          yield { type: "text", delta: event.delta.text };
        }
      }

      const final = await stream.finalMessage();
      usage.in += final.usage?.input_tokens ?? 0;
      usage.out += final.usage?.output_tokens ?? 0;
      usage.cache_read += final.usage?.cache_read_input_tokens ?? 0;
      usage.cache_write += final.usage?.cache_creation_input_tokens ?? 0;

      if (final.stop_reason !== "tool_use") {
        yield { type: "usage", ...usage };
        yield { type: "done" };
        return;
      }

      const toolBlocks = final.content.filter((b) => b.type === "tool_use");

      // A paid tool ends the turn: the client confirms + pays the existing
      // council route, then re-POSTs with the tool_result appended.
      const paid = toolBlocks.find((b) => isPaidTool(String(b.name)));
      if (paid) {
        const meta = PAID_TOOLS[String(paid.name)]!;
        const input = (paid.input ?? {}) as { idea?: string; seat?: string };
        yield {
          type: "confirm_required",
          action: meta.action,
          price: meta.price,
          tool_use_id: String(paid.id),
          args: { idea: String(input.idea ?? ""), seat: input.seat },
        };
        yield { type: "assistant_message", content: final.content };
        yield { type: "usage", ...usage };
        yield { type: "done", pending: true };
        return;
      }

      // Free tools: dispatch inline, append results, loop.
      const results: Array<Record<string, unknown>> = [];
      for (const block of toolBlocks) {
        const name = String(block.name);
        yield { type: "tool_start", name, args: block.input };
        let payload: unknown;
        try {
          payload = await dispatchFreeTool(name, block.input, opts.deps);
        } catch {
          payload = { error: "tool failed" };
        }
        yield { type: "tool_result", name, payload };
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(payload).slice(0, MAX_TOOL_RESULT_CHARS),
        });
      }
      working.push({ role: "assistant", content: final.content });
      working.push({ role: "user", content: results });
    }

    // Tool-loop cap reached.
    yield { type: "usage", ...usage };
    yield { type: "error", message: "Leonardo got stuck in a tool loop — try rephrasing." };
  } catch (e) {
    // Never leak SDK internals; map the common cases to user-safe text.
    const status = (e as { status?: number }).status;
    const raw = e instanceof Error ? e.message : "";
    const message =
      status === 429
        ? "Leonardo is rate-limited right now — try again in a minute."
        : status === 529
          ? "The model service is overloaded — try again shortly."
          : /usage limit/i.test(raw)
            ? "Leonardo's thinking quota is used up for now — it resets on a schedule; try again later."
            : /timed out/i.test(raw)
              ? "Leonardo took too long to answer — try again."
              : "Leonardo hit an internal error — try again.";
    yield { type: "error", message };
  }
}
