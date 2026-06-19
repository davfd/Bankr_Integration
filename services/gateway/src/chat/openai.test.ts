import { describe, it, expect, beforeEach } from "vitest";
import { openaiClient, toOpenAiMessages } from "./openai";
import { runChatTurn } from "./agent";
import type { ChatFrame } from "./frames";

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test";
});

function sseResponse(events: unknown[]): Response {
  const payload = events.map((e) => `data: ${JSON.stringify(e)}\n`).join("\n") + "\ndata: [DONE]\n\n";
  return new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function collect(gen: AsyncGenerator<ChatFrame>): Promise<ChatFrame[]> {
  const frames: ChatFrame[] = [];
  for await (const f of gen) frames.push(f);
  return frames;
}

const deps = { graphSearch: async (q: string) => [{ id: "c1", name: `hit:${q}`, mentions: 2, domain: null, sourceKind: null }] };

describe("openai adapter · message conversion", () => {
  it("maps system, text turns, tool_use and tool_result", () => {
    const msgs = toOpenAiMessages({
      system: [{ text: "You are Leonardo." }],
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "text", text: "calling" }, { type: "tool_use", id: "c1", name: "search_graph", input: { query: "x" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: '{"hits":[]}' }] },
      ],
    });
    expect(msgs[0]).toEqual({ role: "system", content: "You are Leonardo." });
    expect(msgs[1]).toEqual({ role: "user", content: "hi" });
    const asst = msgs[2] as { tool_calls: Array<{ id: string; function: { name: string } }> };
    expect(asst.tool_calls[0]!.id).toBe("c1");
    expect(asst.tool_calls[0]!.function.name).toBe("search_graph");
    expect(msgs[3]).toMatchObject({ role: "tool", tool_call_id: "c1" });
  });
});

describe("openai adapter · through the agent loop", () => {
  it("streams text deltas with exact usage", async () => {
    const client = openaiClient({
      fetchImpl: async () =>
        sseResponse([
          { choices: [{ delta: { content: "Sal" } }] },
          { choices: [{ delta: { content: "ve!" } }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
          { choices: [], usage: { prompt_tokens: 42, completion_tokens: 7 } },
        ]),
    });
    const frames = await collect(runChatTurn({ client, model: "gpt-5.4-mini", messages: [{ role: "user", content: "hi" }], deps }));
    const text = frames.filter((f) => f.type === "text").map((f) => (f as { delta: string }).delta).join("");
    expect(text).toBe("Salve!");
    const usage = frames.find((f) => f.type === "usage") as { in: number; out: number };
    expect(usage.in).toBe(42);
    expect(usage.out).toBe(7);
    expect(frames.at(-1)).toEqual({ type: "done" });
  });

  it("native tool call round-trip: dispatch + result fed back + final answer", async () => {
    let call = 0;
    const bodies: string[] = [];
    const client = openaiClient({
      fetchImpl: async (_url, init) => {
        bodies.push(String(init?.body));
        call++;
        if (call === 1) {
          return sseResponse([
            { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "search_graph", arguments: '{"query":' } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"memory"}' } }] } }] },
            { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
            { choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } },
          ]);
        }
        return sseResponse([
          { choices: [{ delta: { content: "One hit found." } }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
          { choices: [], usage: { prompt_tokens: 30, completion_tokens: 5 } },
        ]);
      },
    });
    const frames = await collect(runChatTurn({ client, model: "gpt-5.4-mini", messages: [{ role: "user", content: "search memory" }], deps }));
    expect(frames.some((f) => f.type === "tool_start" && f.name === "search_graph")).toBe(true);
    expect(bodies[1]).toContain("hit:memory"); // tool result reached round 2
    const text = frames.filter((f) => f.type === "text").map((f) => (f as { delta: string }).delta).join("");
    expect(text).toBe("One hit found.");
    const usage = frames.find((f) => f.type === "usage") as { in: number };
    expect(usage.in).toBe(40); // summed across both rounds
  });

  it("paid tool → confirm_required, single call only", async () => {
    let calls = 0;
    const client = openaiClient({
      fetchImpl: async () => {
        calls++;
        return sseResponse([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_9", function: { name: "council_panel", arguments: '{"idea":"x"}' } }] } }] },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          { choices: [], usage: { prompt_tokens: 9, completion_tokens: 3 } },
        ]);
      },
    });
    const frames = await collect(runChatTurn({ client, model: "gpt-5.4-mini", messages: [{ role: "user", content: "council" }], deps }));
    const confirm = frames.find((f) => f.type === "confirm_required") as Extract<ChatFrame, { type: "confirm_required" }>;
    expect(confirm.action).toBe("council_panel");
    expect(confirm.tool_use_id).toBe("call_9");
    expect(frames.at(-1)).toEqual({ type: "done", pending: true });
    expect(calls).toBe(1);
  });

  it("API error maps to a safe frame", async () => {
    const client = openaiClient({ fetchImpl: async () => new Response("quota", { status: 429 }) });
    const frames = await collect(runChatTurn({ client, model: "gpt-5.4-mini", messages: [{ role: "user", content: "hi" }], deps }));
    expect(frames).toHaveLength(1);
    expect((frames[0] as { message: string }).message).toContain("rate-limited");
  });
});
