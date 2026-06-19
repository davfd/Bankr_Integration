import { describe, it, expect } from "vitest";
import {
  needsCompaction,
  splitForCompaction,
  summarizeOverflow,
  buildWorkingWithSummary,
  SOFT_MAX_MESSAGES,
  KEEP_RECENT,
} from "./compaction";
import type { AnthropicLike, ChatMessage } from "./agent";

function turns(n: number, len = 20): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `turn ${i} ${"x".repeat(len)}`,
  }));
}

// A scripted brain that returns a fixed summary as the assistant text.
function summarizerClient(summaryText: string): AnthropicLike & { calls: number } {
  const self = {
    calls: 0,
    messages: {
      stream() {
        self.calls++;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: "content_block_delta", delta: { type: "text_delta", text: summaryText } };
          },
          async finalMessage() {
            return { content: [{ type: "text", text: summaryText }], stop_reason: "end_turn", usage: {} };
          },
        };
      },
    },
  };
  return self as unknown as AnthropicLike & { calls: number };
}

describe("compaction · thresholds", () => {
  it("does not trigger for a short conversation", () => {
    expect(needsCompaction(turns(6))).toBe(false);
  });
  it("triggers past the message-count soft cap", () => {
    expect(needsCompaction(turns(SOFT_MAX_MESSAGES + 2))).toBe(true);
  });
  it("triggers past the char soft cap even with few messages", () => {
    expect(needsCompaction(turns(4, 6000))).toBe(true);
  });
});

describe("compaction · split", () => {
  it("keeps the last KEEP_RECENT verbatim and the rest as overflow", () => {
    const all = turns(30);
    const { overflow, recent } = splitForCompaction(all);
    expect(recent).toHaveLength(KEEP_RECENT);
    expect(overflow).toHaveLength(30 - KEEP_RECENT);
    expect(recent[recent.length - 1]).toEqual(all[all.length - 1]); // newest preserved
  });
  it("no overflow when at/below the keep window", () => {
    const { overflow, recent } = splitForCompaction(turns(KEEP_RECENT));
    expect(overflow).toHaveLength(0);
    expect(recent).toHaveLength(KEEP_RECENT);
  });
});

describe("compaction · summarizeOverflow", () => {
  it("folds the overflow into a bounded summary via one brain call", async () => {
    const client = summarizerClient("Conversation so far: user wants X; decided Y.");
    const out = await summarizeOverflow({ client, model: "m", overflow: turns(18) });
    expect(out).toContain("Conversation so far");
    expect((client as unknown as { calls: number }).calls).toBe(1);
  });
  it("includes the prior summary in the brain input (incremental fold)", async () => {
    let seen = "";
    const client = {
      messages: {
        stream(p: Record<string, unknown>) {
          seen = JSON.stringify(p.messages);
          return {
            async *[Symbol.asyncIterator]() {},
            async finalMessage() {
              return { content: [{ type: "text", text: "folded" }], stop_reason: "end_turn" };
            },
          };
        },
      },
    } as unknown as AnthropicLike;
    await summarizeOverflow({ client, model: "m", priorSummary: "EARLIER_SUMMARY_MARKER", overflow: turns(14) });
    expect(seen).toContain("EARLIER_SUMMARY_MARKER");
  });
});

describe("compaction · buildWorkingWithSummary", () => {
  it("merges the summary into the first plain-text user turn (clean alternation)", () => {
    const recent: ChatMessage[] = [
      { role: "user", content: "latest question" },
      { role: "assistant", content: "answer" },
    ];
    const w = buildWorkingWithSummary("S", recent);
    expect(w).toHaveLength(2);
    expect(w[0]!.role).toBe("user");
    expect(String(w[0]!.content)).toContain("S");
    expect(String(w[0]!.content)).toContain("latest question");
  });
  it("prepends a standalone user turn when recent starts with assistant", () => {
    const recent: ChatMessage[] = [{ role: "assistant", content: "a" }, { role: "user", content: "u" }];
    const w = buildWorkingWithSummary("S", recent);
    expect(w).toHaveLength(3);
    expect(w[0]!.role).toBe("user");
    expect(String(w[0]!.content)).toContain("S");
  });
  it("returns recent unchanged when summary is empty", () => {
    const recent = turns(3);
    expect(buildWorkingWithSummary("", recent)).toBe(recent);
  });
});
