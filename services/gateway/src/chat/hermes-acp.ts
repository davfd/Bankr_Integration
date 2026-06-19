// Hermes ACP brain: streams ChatFrames from the REAL read-only Leonardo agent.
//
// This bypasses runChatTurn entirely — the Hermes agent runs its own tool loop,
// memory, and compaction. We own one long-lived Python bridge subprocess
// (services/hermes-acp/bridge.py) that keeps a single read-only ACP agent alive,
// maps each web conversation to a persistent ACP session, denies every tool
// permission, and exposes the graph/council as a read-only MCP. The bridge speaks
// a JSON-line protocol; we translate its frames into the existing ChatFrame SSE
// contract so the web client is unchanged.
import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChatFrame } from "./frames";

const HERMES_PY = process.env.HERMES_VENV_PY ?? "/home/exor/.hermes/hermes-agent/venv/bin/python";
const REPO_ROOT = process.env.LEO_PLATFORM_ROOT ?? join(homedir(), "leonardo-platform");
const BRIDGE = join(REPO_ROOT, "services", "hermes-acp", "bridge.py");

type BridgeFrame =
  | { f: "ready" }
  | { f: "pong" }
  | { f: "text"; d: string }
  | { f: "tool"; n: string }
  | { f: "usage"; in: number; out: number }
  | { f: "done"; stop?: string }
  | { f: "err"; m: string };

// ── one shared bridge process, lazily started ────────────────────────────────
let proc: ChildProcess | null = null;
let ready: Promise<void> | null = null;
let buf = "";
const lineWaiters: Array<(f: BridgeFrame) => void> = [];

function onLine(line: string): void {
  let frame: BridgeFrame;
  try {
    frame = JSON.parse(line) as BridgeFrame;
  } catch {
    return; // non-JSON (stray log) — ignore
  }
  const w = lineWaiters.shift();
  if (w) w(frame);
  else pending.push(frame);
}
// frames that arrived with no waiter yet (e.g. the initial "ready")
const pending: BridgeFrame[] = [];

function nextFrame(): Promise<BridgeFrame> {
  const queued = pending.shift();
  if (queued) return Promise.resolve(queued);
  return new Promise((resolve) => lineWaiters.push(resolve));
}

function ensureBridge(): Promise<void> {
  if (ready) return ready;
  ready = new Promise<void>((resolve, reject) => {
    const child = spawn(HERMES_PY, [BRIDGE], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        LEO_WEB_PROFILE: process.env.LEO_WEB_PROFILE ?? "leonardo-web",
        WORKSHOP_SIDECAR_URL: process.env.WORKSHOP_SIDECAR_URL ?? "http://127.0.0.1:8799",
      },
      stdio: ["pipe", "pipe", "inherit"], // inherit stderr → gateway log (and never blocks)
    });
    proc = child;

    const stdout = child.stdout!;
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) onLine(line);
      }
    });
    child.on("exit", (code) => {
      proc = null;
      ready = null;
      // wake any waiters so in-flight turns fail cleanly instead of hanging
      while (lineWaiters.length) lineWaiters.shift()!({ f: "err", m: `bridge exited (${code})` });
    });
    child.on("error", (e) => reject(e));

    // The bridge emits {"f":"ready"} once the ACP agent is initialized.
    (async () => {
      const t = setTimeout(() => reject(new Error("bridge init timeout")), 200_000);
      for (;;) {
        const f = await nextFrame();
        if (f.f === "ready") {
          clearTimeout(t);
          resolve();
          return;
        }
        if (f.f === "err") {
          clearTimeout(t);
          reject(new Error(f.m));
          return;
        }
      }
    })().catch(reject);
  });
  return ready;
}

// Serialize turns: the single agent processes one prompt at a time.
let turnLock: Promise<void> = Promise.resolve();

/** Stream a Hermes turn as ChatFrames. `conversationId` pins the ACP session
 *  (so Hermes keeps per-conversation memory across turns). */
export async function* runHermesTurn(opts: {
  conversationId: string;
  text: string;
  /** Member-context block; the bridge injects it only when it opens a fresh ACP
   *  session (so a returning member is recognized without re-stating it). */
  preamble?: string;
}): AsyncGenerator<ChatFrame> {
  await ensureBridge();
  // acquire the turn lock
  let release!: () => void;
  const prev = turnLock;
  turnLock = new Promise<void>((r) => (release = r));
  await prev;
  let turnComplete = false; // saw this turn's done/err frame
  try {
    if (!proc?.stdin) throw new Error("bridge not running");
    proc.stdin.write(
      JSON.stringify({ op: "prompt", cid: opts.conversationId, text: opts.text, preamble: opts.preamble ?? "" }) + "\n",
    );
    for (;;) {
      const f = await nextFrame();
      if (f.f === "text") yield { type: "text", delta: f.d };
      else if (f.f === "tool") yield { type: "tool_start", name: f.n, args: {} };
      else if (f.f === "usage") yield { type: "usage", in: f.in, out: f.out };
      else if (f.f === "err") {
        turnComplete = true;
        yield { type: "error", message: "Leonardo hit a snag — try again." };
        return;
      } else if (f.f === "done") {
        turnComplete = true;
        yield { type: "done" };
        return;
      }
      // ignore ready/pong mid-turn
    }
  } finally {
    // CRITICAL: if the consumer bailed early (client disconnect / curl timeout), the
    // bridge is still emitting this turn's frames. We MUST drain them through to the
    // turn's done/err before releasing the lock — otherwise the NEXT turn consumes
    // this turn's leftover frames (wrong, and on a shared bridge, cross-user) reply.
    if (!turnComplete) {
      const drainDeadline = Date.now() + 320_000; // bridge turn timeout is 300s
      try {
        while (Date.now() < drainDeadline) {
          const f = await nextFrame();
          if (f.f === "done" || f.f === "err") break;
        }
      } catch {
        // bridge died mid-drain; exit handler already woke waiters
      }
    }
    release();
  }
}
