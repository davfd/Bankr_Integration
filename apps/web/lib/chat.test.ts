import { describe, it, expect } from "vitest";
import { parseSSE, appendToolRound, sendChat, type ChatFrame } from "./chat";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe("chat SSE parser", () => {
  it("parses frames split across chunk boundaries and skips heartbeats", async () => {
    const frames: ChatFrame[] = [];
    await parseSSE(
      streamOf([
        'data: {"type":"text","del',
        'ta":"Hel"}\n\n: ping\n\ndata: {"type":"text","delta":"lo"}\n\nda',
        'ta: {"type":"done"}\n\n',
      ]),
      (f) => frames.push(f),
    );
    expect(frames).toEqual([
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
      { type: "done" },
    ]);
  });

  it("tolerates a malformed line without killing the stream", async () => {
    const frames: ChatFrame[] = [];
    await parseSSE(streamOf(['data: {broken\n\ndata: {"type":"done"}\n\n']), (f) => frames.push(f));
    expect(frames).toEqual([{ type: "done" }]);
  });
});

describe("chat request payload", () => {
  function okFetch(bodies: unknown[]): (input: string, init?: RequestInit) => Promise<Response> {
    return async (_input: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(streamOf(['data: {"type":"done"}\n\n']), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
  }

  it("sends the demo ERC-8004 passport id with chat turns so gateway enforcement has a binding", async () => {
    const bodies: unknown[] = [];
    const frames: ChatFrame[] = [];

    await sendChat({
      messages: [{ role: "user", content: "hello" }],
      fetchImpl: okFetch(bodies),
      onFrame: (frame) => frames.push(frame),
    });

    expect(bodies).toEqual([expect.objectContaining({ passport_id: "6960" })]);
    expect(frames).toEqual([{ type: "done" }]);
  });

  it("uses the active minted passport id from localStorage before falling back to the demo passport", async () => {
    const prior = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const store = new Map<string, string>([
      ["leo_session", "leo2.0xabc.9999999999999.holder.sig"],
      ["leo_agent_passport_id", "4242"],
    ]);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });

    try {
      const bodies: unknown[] = [];
      await sendChat({
        messages: [{ role: "user", content: "hello" }],
        fetchImpl: okFetch(bodies),
        onFrame: () => {},
      });

      expect(bodies).toEqual([expect.objectContaining({ passport_id: "4242" })]);
    } finally {
      if (prior) Object.defineProperty(globalThis, "localStorage", prior);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});

describe("history helpers", () => {
  it("appendToolRound appends the assistant turn + tool_result (with is_error on decline)", () => {
    const h = appendToolRound([{ role: "user", content: "hi" }], [{ type: "tool_use", id: "t1" }], "t1", "declined", true);
    expect(h).toHaveLength(3);
    expect(h[1]).toEqual({ role: "assistant", content: [{ type: "tool_use", id: "t1" }] });
    const block = (h[2]!.content as Array<Record<string, unknown>>)[0]!;
    expect(block.tool_use_id).toBe("t1");
    expect(block.is_error).toBe(true);
  });
});
