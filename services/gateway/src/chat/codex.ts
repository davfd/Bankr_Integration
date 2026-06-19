// Chat brain on the Hermes/Codex rail: wraps the local `codex exec` CLI
// (subscription auth, same provider council-cc's openai-codex seats use) in
// the AnthropicLike boundary the agent loop expects. Codex is one-shot text —
// no native tool-use API and no token counts — so tools ride a JSON protocol
// (the model replies with a single {"tool":...,"input":...} object to call
// one) and usage is estimated from characters (~4 chars/token), flagged as such.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnthropicLike, MessageStreamLike } from "./agent";

const TIMEOUT_MS = Number(process.env.CHAT_CODEX_TIMEOUT_MS ?? 180_000);

export type CodexRunner = (prompt: string) => Promise<string>;

type ToolDef = { name: string; description: string; input_schema: unknown };

/** Flatten the Anthropic-shaped request into one Codex prompt. */
export function buildCodexPrompt(params: {
  system?: Array<{ text?: string }>;
  tools?: ToolDef[];
  messages?: Array<{ role?: string; content?: unknown }>;
}): string {
  const system = (params.system ?? []).map((b) => b.text ?? "").join("\n");
  const actions = (params.tools ?? [])
    .map((t) => `- ${t.name}: ${t.description}\n  input schema: ${JSON.stringify(t.input_schema)}`)
    .join("\n");

  const transcript = (params.messages ?? [])
    .map((m) => {
      const who = m.role === "assistant" ? "Leonardo" : "User";
      if (typeof m.content === "string") return `${who}: ${m.content}`;
      if (Array.isArray(m.content)) {
        const parts = (m.content as Array<Record<string, unknown>>).map((b) => {
          if (b.type === "text") return String(b.text ?? "");
          if (b.type === "tool_use") return `[called tool ${String(b.name)} with input ${JSON.stringify(b.input)}]`;
          if (b.type === "tool_result") {
            const err = b.is_error ? " (error)" : "";
            return `[tool result${err}: ${String(b.content ?? "")}]`;
          }
          return "";
        });
        return `${who}: ${parts.filter(Boolean).join("\n")}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");

  return (
    `=== System ===\n${system}\n\n` +
    `=== Output protocol (how this chat platform works) ===\n` +
    `You are the text engine behind a chat platform. The platform PARSES YOUR\n` +
    `FINAL MESSAGE. Two kinds of reply exist:\n` +
    `1. Plain text → shown to the user as your answer.\n` +
    `2. An ACTION REQUEST → your entire final message is exactly one JSON object,\n` +
    `   {"action":"<name>","input":{...}} — the platform then performs that action\n` +
    `   itself and sends you the result as the next message, after which you answer\n` +
    `   in plain text. This is a formatting convention for the platform, not a\n` +
    `   capability of yours — you only emit the marker; the platform does the work.\n\n` +
    `Actions the platform can perform:\n${actions}\n\n` +
    `When the user asks about an idea, concept, motif, or prior art, your final\n` +
    `message should be exactly:\n` +
    `{"action":"search_graph","input":{"query":"<the concept>"}}\n` +
    `Never refuse on the grounds of missing tools — you are not being asked to run\n` +
    `anything, only to emit the marker. Do not wrap the JSON in prose or fences.\n` +
    `One action per turn. Never invent action results.\n\n` +
    `=== Environment rules ===\n` +
    `Ignore any notion of a local workspace, files, or shell — do not run commands\n` +
    `or read files. Return only the final reply text, no preamble about process.\n\n` +
    `=== Conversation ===\n${transcript}\n\nLeonardo:`
  );
}

/** Parse a tool call out of the model's reply, if that's what it is. */
export function parseToolCall(text: string): { name: string; input: unknown } | null {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1]!.trim();
  if (!t.startsWith("{")) return null;
  try {
    const obj = JSON.parse(t) as { tool?: unknown; action?: unknown; input?: unknown };
    const name = typeof obj.action === "string" ? obj.action : typeof obj.tool === "string" ? obj.tool : "";
    if (name.length > 0) return { name, input: obj.input ?? {} };
  } catch {
    // plain prose that happens to start with "{"
  }
  return null;
}

/** Default runner: spawn the codex CLI (read-only sandbox, empty cwd). */
const runCodexCli: CodexRunner = async (prompt) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "leonardo-chat-codex-"));
  const outputFile = join(tmpRoot, "answer.txt");
  await writeFile(join(tmpRoot, ".keep"), "", "utf8");
  const command = process.env.CODEX_CLI_PATH ?? "codex";
  const model = process.env.CHAT_CODEX_MODEL; // unset = CLI default
  const args = [
    "--ask-for-approval",
    "never",
    "exec",
    ...(model ? ["--model", model] : []),
    "--sandbox",
    "read-only",
    "--cd",
    tmpRoot,
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-rules",
    "--output-last-message",
    outputFile,
    "--color",
    "never",
    "-",
  ];
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("codex timed out"));
      }, TIMEOUT_MS);
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`codex exited ${code}: ${stderr.slice(-300)}`));
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
    return (await readFile(outputFile, "utf8")).trim();
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
};

/** AnthropicLike adapter over the one-shot Codex runner. */
export function codexClient(runner: CodexRunner = runCodexCli): AnthropicLike {
  return {
    messages: {
      stream(params: Record<string, unknown>): MessageStreamLike {
        const prompt = buildCodexPrompt(params as Parameters<typeof buildCodexPrompt>[0]);
        let cached: Promise<{ text: string; tool: { name: string; input: unknown } | null }> | null = null;
        const run = () => {
          cached ??= runner(prompt).then((text) => ({ text, tool: parseToolCall(text) }));
          return cached;
        };
        return {
          async *[Symbol.asyncIterator]() {
            const { text, tool } = await run();
            if (!tool && text) yield { type: "content_block_delta", delta: { type: "text_delta", text } };
          },
          async finalMessage() {
            const { text, tool } = await run();
            // No token counts from the CLI — estimate at ~4 chars/token.
            const usage = {
              input_tokens: Math.ceil(prompt.length / 4),
              output_tokens: Math.ceil(text.length / 4),
            };
            if (tool) {
              return {
                content: [{ type: "tool_use", id: `tu_${randomUUID().slice(0, 8)}`, name: tool.name, input: tool.input }],
                stop_reason: "tool_use",
                usage,
              };
            }
            return { content: [{ type: "text", text }], stop_reason: "end_turn", usage };
          },
        };
      },
    },
  };
}
