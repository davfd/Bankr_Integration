import { beforeEach, describe, it, expect } from "vitest";
import { runChatTurn, clampHistory, type AnthropicLike, type MessageStreamLike } from "./agent";
import type { ChatFrame } from "./frames";

// ── scripted SDK mock ────────────────────────────────────────────────────────
type Turn = {
  text?: string;
  stop_reason: string;
  content: Array<Record<string, unknown>>;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
};

function mockClient(turns: Turn[]): AnthropicLike & { calls: Array<Record<string, unknown>> } {
  let i = 0;
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    messages: {
      stream(params: Record<string, unknown>): MessageStreamLike {
        calls.push(params);
        const turn = turns[Math.min(i, turns.length - 1)]!;
        i++;
        return {
          async *[Symbol.asyncIterator]() {
            if (turn.text) {
              for (const ch of turn.text.match(/.{1,5}/g) ?? []) {
                yield { type: "content_block_delta", delta: { type: "text_delta", text: ch } };
              }
            }
          },
          async finalMessage() {
            return { content: turn.content, stop_reason: turn.stop_reason, usage: turn.usage };
          },
        };
      },
    },
  };
}

async function collect(gen: AsyncGenerator<ChatFrame>): Promise<ChatFrame[]> {
  const frames: ChatFrame[] = [];
  for await (const f of gen) frames.push(f);
  return frames;
}

const deps = { graphSearch: async (q: string) => [{ id: "c1", name: `hit:${q}`, mentions: 3, domain: null, sourceKind: null }] };
const user = (text: string) => [{ role: "user" as const, content: text }];

beforeEach(() => {
  delete process.env.WORKSHOP_SIDECAR_URL;
});

describe("chat agent · frames", () => {
  it("streams text deltas, then usage and done", async () => {
    const client = mockClient([
      { text: "Hello friend", stop_reason: "end_turn", content: [{ type: "text", text: "Hello friend" }], usage: { input_tokens: 100, output_tokens: 20 } },
    ]);
    const frames = await collect(runChatTurn({ client, model: "m", messages: user("hi"), deps }));
    const text = frames.filter((f) => f.type === "text").map((f) => (f as { delta: string }).delta).join("");
    expect(text).toBe("Hello friend");
    const usage = frames.find((f) => f.type === "usage") as { in: number; out: number };
    expect(usage.in).toBe(100);
    expect(usage.out).toBe(20);
    expect(frames.at(-1)).toEqual({ type: "done" });
  });

  it("dispatches a free tool inline and loops, summing usage across iterations", async () => {
    const client = mockClient([
      {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_1", name: "search_graph", input: { query: "memory" } }],
        usage: { input_tokens: 100, output_tokens: 10 },
      },
      { text: "Found it.", stop_reason: "end_turn", content: [{ type: "text", text: "Found it." }], usage: { input_tokens: 150, output_tokens: 30 } },
    ]);
    const frames = await collect(runChatTurn({ client, model: "m", messages: user("search memory"), deps }));
    expect(frames.some((f) => f.type === "tool_start" && f.name === "search_graph")).toBe(true);
    const result = frames.find((f) => f.type === "tool_result") as { payload: { hits: { name: string }[] } };
    expect(result.payload.hits[0]?.name).toBe("hit:memory");
    const usage = frames.find((f) => f.type === "usage") as { in: number; out: number };
    expect(usage.in).toBe(250); // summed across both iterations
    expect(usage.out).toBe(40);
    expect(client.calls).toHaveLength(2);
    // second call carries the tool_result back
    const second = client.calls[1] as { messages: Array<{ role: string }> };
    expect(second.messages.at(-1)?.role).toBe("user");
  });

  it("paid tool → confirm_required + assistant_message + done{pending}, and never executes", async () => {
    const client = mockClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "This costs $0.25 — convening." },
          { type: "tool_use", id: "tu_9", name: "council_panel", input: { idea: "bind authority to a true name" } },
        ],
        usage: { input_tokens: 80, output_tokens: 15 },
      },
    ]);
    let councilCalled = false;
    const frames = await collect(
      runChatTurn({
        client,
        model: "m",
        messages: user("full council please"),
        deps: { graphSearch: async () => { councilCalled = true; return []; } },
      }),
    );
    const confirm = frames.find((f) => f.type === "confirm_required") as Extract<ChatFrame, { type: "confirm_required" }>;
    expect(confirm.action).toBe("council_panel");
    expect(confirm.price).toBe("$0.25");
    expect(confirm.tool_use_id).toBe("tu_9");
    expect(confirm.args.idea).toContain("true name");
    expect(frames.some((f) => f.type === "assistant_message")).toBe(true);
    expect(frames.at(-1)).toEqual({ type: "done", pending: true });
    expect(councilCalled).toBe(false); // nothing dispatched server-side
    expect(client.calls).toHaveLength(1); // turn ended, no continuation
  });

  it("caps the tool loop and exits with an error frame", async () => {
    const client = mockClient([
      {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_x", name: "search_graph", input: { query: "loop" } }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ]); // same tool_use turn forever
    const frames = await collect(runChatTurn({ client, model: "m", messages: user("loop"), deps }));
    expect(client.calls.length).toBeLessThanOrEqual(4);
    expect(frames.at(-1)?.type).toBe("error");
  });

  it("maps SDK errors to a safe error frame (no internals)", async () => {
    const client: AnthropicLike = {
      messages: {
        stream() {
          const err = new Error("secret stack details") as Error & { status: number };
          err.status = 429;
          throw err;
        },
      },
    };
    const frames = await collect(runChatTurn({ client, model: "m", messages: user("hi"), deps }));
    expect(frames).toHaveLength(1);
    const e = frames[0] as { type: string; message: string };
    expect(e.type).toBe("error");
    expect(e.message).toContain("rate-limited");
    expect(e.message).not.toContain("secret");
  });

  it("workshop_research returns the honest coming-soon payload", async () => {
    const client = mockClient([
      {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_w", name: "workshop_research", input: { topic: "x" } }],
      },
      { text: "Not yet.", stop_reason: "end_turn", content: [{ type: "text", text: "Not yet." }] },
    ]);
    const frames = await collect(runChatTurn({ client, model: "m", messages: user("research x"), deps }));
    const result = frames.find((f) => f.type === "tool_result") as { payload: { status: string } };
    expect(result.payload.status).toBe("coming_soon");
  });
});

describe("chat agent · history bounding", () => {
  it("clamps to 40 messages keeping the most recent", () => {
    const long = Array.from({ length: 60 }, (_, i) => ({ role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant", content: `m${i}` }));
    const kept = clampHistory(long)!;
    expect(kept.length).toBeLessThanOrEqual(40);
    expect(kept.at(-1)?.content).toBe("m59");
    expect(kept[0]?.role).toBe("user"); // first must be user
  });

  it("trims oversized histories by dropping oldest turns", () => {
    const big = Array.from({ length: 10 }, (_, i) => ({ role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant", content: "x".repeat(5000) }));
    const kept = clampHistory(big)!;
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(30_000);
    expect(kept.length).toBeGreaterThan(0);
  });

  it("rejects unusable history with an error frame", async () => {
    const client = mockClient([{ stop_reason: "end_turn", content: [] }]);
    const frames = await collect(runChatTurn({ client, model: "m", messages: "not-an-array", deps }));
    expect(frames).toHaveLength(1);
    expect(frames[0]?.type).toBe("error");
  });

  it("compacts a long history: emits a compaction frame and replays summary + recent", async () => {
    const long = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `turn${i}`,
    }));
    const client = mockClient([
      { stop_reason: "end_turn", content: [{ type: "text", text: "RUNNING SUMMARY" }] }, // summarizer call
      { text: "ok", stop_reason: "end_turn", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 5, output_tokens: 2 } }, // main
    ]);
    const frames = await collect(runChatTurn({ client, model: "m", messages: long, deps }));
    const comp = frames.find((f) => f.type === "compaction") as Extract<ChatFrame, { type: "compaction" }>;
    expect(comp).toBeTruthy();
    expect(comp.summary).toContain("RUNNING SUMMARY");
    expect(comp.throughCount).toBe(30 - 12); // overflow = all but the last KEEP_RECENT
    // The main (2nd) brain call carries the summary in its first user turn + the recent window.
    const main = client.calls[1] as { messages: Array<{ role: string; content: unknown }> };
    expect(main.messages[0]!.role).toBe("user");
    expect(JSON.stringify(main.messages[0]!.content)).toContain("RUNNING SUMMARY");
    expect(JSON.stringify(main.messages)).toContain("turn29"); // newest preserved verbatim
    expect(JSON.stringify(main.messages)).not.toContain("turn0"); // oldest folded away
  });

  it("does not compact a short history (single brain call, no compaction frame)", async () => {
    const client = mockClient([{ text: "hi", stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] }]);
    const frames = await collect(runChatTurn({ client, model: "m", messages: user("hello"), deps }));
    expect(frames.some((f) => f.type === "compaction")).toBe(false);
    expect(client.calls).toHaveLength(1);
  });

  it("folds a prior summary into the new one (incremental compaction)", async () => {
    const long = Array.from({ length: 28 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `t${i}`,
    }));
    const client = mockClient([
      { stop_reason: "end_turn", content: [{ type: "text", text: "NEW SUMMARY" }] },
      { text: "ok", stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] },
    ]);
    await collect(runChatTurn({ client, model: "m", messages: long, deps, priorSummary: "PRIOR_MARKER" }));
    // The summarizer (1st) call must see the prior summary so it can fold it.
    const summarizerCall = client.calls[0] as { messages: Array<{ content: unknown }> };
    expect(JSON.stringify(summarizerCall.messages)).toContain("PRIOR_MARKER");
  });

  it("truncates oversized client-supplied tool_result blocks", () => {
    const kept = clampHistory([
      { role: "user", content: "q" },
      { role: "assistant", content: [{ type: "tool_use", id: "t", name: "council_panel", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "y".repeat(20_000) }] },
    ])!;
    const block = (kept.at(-1)!.content as Array<{ content: string }>)[0]!;
    expect(block.content.length).toBeLessThanOrEqual(8_100);
  });
});
