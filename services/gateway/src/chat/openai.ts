// Chat brain on the OpenAI API (e.g. gpt-5.4-mini): real streaming, NATIVE
// tool calls, and exact token counts — wrapped in the same AnthropicLike
// boundary the agent loop expects, so tools/frames/metering work unchanged.
import { randomUUID } from "node:crypto";
import type { AnthropicLike, MessageStreamLike } from "./agent";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type ToolDef = { name: string; description: string; input_schema: unknown };
type Params = {
  model?: string;
  system?: Array<{ text?: string }>;
  tools?: ToolDef[];
  messages?: Array<{ role?: string; content?: unknown }>;
  max_tokens?: number;
};

/** Convert Anthropic-shaped history to OpenAI chat messages. */
export function toOpenAiMessages(params: Params): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const system = (params.system ?? []).map((b) => b.text ?? "").join("\n");
  if (system) out.push({ role: "system", content: system });

  for (const m of params.messages ?? []) {
    const role = m.role === "assistant" ? "assistant" : "user";
    if (typeof m.content === "string") {
      out.push({ role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content)) continue;
    const blocks = m.content as Array<Record<string, unknown>>;
    const text = blocks.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n");
    const toolUses = blocks.filter((b) => b.type === "tool_use");
    const toolResults = blocks.filter((b) => b.type === "tool_result");

    if (role === "assistant") {
      const msg: Record<string, unknown> = { role: "assistant", content: text || null };
      if (toolUses.length > 0) {
        msg.tool_calls = toolUses.map((b) => ({
          id: String(b.id ?? `call_${randomUUID().slice(0, 8)}`),
          type: "function",
          function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) },
        }));
      }
      out.push(msg);
    } else {
      // tool_result blocks become role:"tool" messages (must follow the
      // assistant turn that carried the matching tool_calls — our history
      // preserves that order).
      for (const r of toolResults) {
        out.push({
          role: "tool",
          tool_call_id: String(r.tool_use_id ?? ""),
          content: typeof r.content === "string" ? r.content : JSON.stringify(r.content ?? ""),
        });
      }
      if (text) out.push({ role: "user", content: text });
    }
  }
  return out;
}

/** AnthropicLike adapter over the OpenAI Chat Completions streaming API. */
export function openaiClient(opts: { fetchImpl?: FetchLike } = {}): AnthropicLike {
  const doFetch: FetchLike = opts.fetchImpl ?? fetch;
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

  return {
    messages: {
      stream(params: Record<string, unknown>): MessageStreamLike {
        const p = params as Params;
        const body = {
          model: p.model,
          stream: true,
          stream_options: { include_usage: true },
          max_completion_tokens: p.max_tokens ?? 4096,
          messages: toOpenAiMessages(p),
          ...(p.tools && p.tools.length > 0
            ? {
                tools: p.tools.map((t) => ({
                  type: "function",
                  function: { name: t.name, description: t.description, parameters: t.input_schema },
                })),
                tool_choice: "auto",
              }
            : {}),
        };

        const state = {
          text: "",
          toolCalls: [] as { id: string; name: string; args: string }[],
          finish: null as string | null,
          usage: { input_tokens: 0, output_tokens: 0 },
        };

        async function* run(): AsyncGenerator<{ type: string; delta?: { type?: string; text?: string } }> {
          const key = process.env.OPENAI_API_KEY;
          if (!key) throw new Error("OPENAI_API_KEY is not set");
          const res = await doFetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok || !res.body) {
            const errText = await res.text().catch(() => "");
            const e = new Error(`openai ${res.status}: ${errText.slice(0, 200)}`) as Error & { status: number };
            e.status = res.status;
            throw e;
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buffer.indexOf("\n")) !== -1) {
              const line = buffer.slice(0, nl).trim();
              buffer = buffer.slice(nl + 1);
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6);
              if (data === "[DONE]") continue;
              let chunk: {
                choices?: Array<{
                  delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
                  finish_reason?: string | null;
                }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number };
              };
              try {
                chunk = JSON.parse(data);
              } catch {
                continue;
              }
              if (chunk.usage) {
                state.usage.input_tokens = chunk.usage.prompt_tokens ?? 0;
                state.usage.output_tokens = chunk.usage.completion_tokens ?? 0;
              }
              const choice = chunk.choices?.[0];
              if (!choice) continue;
              if (choice.finish_reason) state.finish = choice.finish_reason;
              const delta = choice.delta;
              if (!delta) continue;
              if (delta.content) {
                state.text += delta.content;
                yield { type: "content_block_delta", delta: { type: "text_delta", text: delta.content } };
              }
              for (const tc of delta.tool_calls ?? []) {
                const slot = (state.toolCalls[tc.index] ??= { id: "", name: "", args: "" });
                if (tc.id) slot.id = tc.id;
                if (tc.function?.name) slot.name += tc.function.name;
                if (tc.function?.arguments) slot.args += tc.function.arguments;
              }
            }
          }
        }

        const gen = run();
        return {
          [Symbol.asyncIterator]: () => gen,
          async finalMessage() {
            // Drain whatever the iterator didn't consume, then assemble.
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for await (const _ of gen) {
              // draining
            }
            const content: Array<Record<string, unknown>> = [];
            if (state.text) content.push({ type: "text", text: state.text });
            for (const tc of state.toolCalls) {
              if (!tc.name) continue;
              let input: unknown = {};
              try {
                input = tc.args ? JSON.parse(tc.args) : {};
              } catch {
                input = {};
              }
              content.push({ type: "tool_use", id: tc.id || `call_${randomUUID().slice(0, 8)}`, name: tc.name, input });
            }
            const hasTools = state.toolCalls.some((t) => t.name);
            return {
              content,
              stop_reason: hasTools ? "tool_use" : "end_turn",
              usage: state.usage,
            };
          },
        };
      },
    },
  };
}
