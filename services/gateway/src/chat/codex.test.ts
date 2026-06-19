import { describe, it, expect } from "vitest";
import { codexClient, buildCodexPrompt, parseToolCall } from "./codex";
import { runChatTurn } from "./agent";
import type { ChatFrame } from "./frames";

async function collect(gen: AsyncGenerator<ChatFrame>): Promise<ChatFrame[]> {
  const frames: ChatFrame[] = [];
  for await (const f of gen) frames.push(f);
  return frames;
}

describe("codex adapter · parsing", () => {
  it("recognizes a bare JSON tool call", () => {
    expect(parseToolCall('{"tool":"search_graph","input":{"query":"memory"}}')).toEqual({
      name: "search_graph",
      input: { query: "memory" },
    });
  });

  it("recognizes a fenced tool call", () => {
    expect(parseToolCall('```json\n{"tool":"council_panel","input":{"idea":"x"}}\n```')).toEqual({
      name: "council_panel",
      input: { idea: "x" },
    });
  });

  it("treats prose (even brace-leading) as text", () => {
    expect(parseToolCall("Hello there")).toBeNull();
    expect(parseToolCall("{not json at all")).toBeNull();
    expect(parseToolCall('{"answer": 42}')).toBeNull(); // no tool key
  });
});

describe("codex adapter · prompt", () => {
  it("flattens system, tools, and the transcript including tool rounds", () => {
    const prompt = buildCodexPrompt({
      system: [{ text: "You are Leonardo." }],
      tools: [{ name: "search_graph", description: "Search.", input_schema: { type: "object" } }],
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "tool_use", name: "search_graph", input: { query: "x" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: '{"hits":[]}' }] },
      ],
    });
    expect(prompt).toContain("You are Leonardo.");
    expect(prompt).toContain("- search_graph: Search.");
    expect(prompt).toContain("User: hi");
    expect(prompt).toContain("[called tool search_graph");
    expect(prompt).toContain('[tool result: {"hits":[]}]');
    expect(prompt).toContain('{"action":"<name>","input":{...}}');
  });
});

describe("codex adapter · through the agent loop", () => {
  const deps = { graphSearch: async (q: string) => [{ id: "c1", name: `hit:${q}`, mentions: 1, domain: null, sourceKind: null }] };

  it("plain reply → one text delta + end_turn with estimated usage", async () => {
    const client = codexClient(async () => "Salve! I am Leonardo.");
    const frames = await collect(runChatTurn({ client, model: "ignored", messages: [{ role: "user", content: "hi" }], deps }));
    const text = frames.filter((f) => f.type === "text").map((f) => (f as { delta: string }).delta).join("");
    expect(text).toBe("Salve! I am Leonardo.");
    const usage = frames.find((f) => f.type === "usage") as { in: number; out: number };
    expect(usage.in).toBeGreaterThan(0);
    expect(usage.out).toBeGreaterThan(0);
    expect(frames.at(-1)).toEqual({ type: "done" });
  });

  it("tool-call reply → free tool dispatched, result fed back, second call answers", async () => {
    let call = 0;
    const prompts: string[] = [];
    const client = codexClient(async (prompt) => {
      prompts.push(prompt);
      call++;
      return call === 1 ? '{"tool":"search_graph","input":{"query":"memory"}}' : "The graph holds one hit.";
    });
    const frames = await collect(runChatTurn({ client, model: "ignored", messages: [{ role: "user", content: "search memory" }], deps }));
    expect(frames.some((f) => f.type === "tool_start" && f.name === "search_graph")).toBe(true);
    expect(prompts[1]).toContain("hit:memory"); // tool result reached the second call
    const text = frames.filter((f) => f.type === "text").map((f) => (f as { delta: string }).delta).join("");
    expect(text).toBe("The graph holds one hit.");
  });

  it("paid tool call → confirm_required, codex not called again", async () => {
    let calls = 0;
    const client = codexClient(async () => {
      calls++;
      return '{"tool":"council_panel","input":{"idea":"bind authority to a true name"}}';
    });
    const frames = await collect(runChatTurn({ client, model: "ignored", messages: [{ role: "user", content: "full council" }], deps }));
    const confirm = frames.find((f) => f.type === "confirm_required") as Extract<ChatFrame, { type: "confirm_required" }>;
    expect(confirm.action).toBe("council_panel");
    expect(confirm.price).toBe("$0.25");
    expect(frames.at(-1)).toEqual({ type: "done", pending: true });
    expect(calls).toBe(1);
  });
});
