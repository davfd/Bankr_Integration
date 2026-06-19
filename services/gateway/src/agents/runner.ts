// Hosted Agent runner (beta slice): one isolated Hermes instance per wallet.
// Each agent gets its own HERMES_HOME (state, sessions, logs fully separate)
// seeded from a platform template profile (the model credential is the
// platform's; the wallet pays the platform, the platform pays the model).
// Prompts run headless via `hermes -z` inside the agent's own workspace.
//
// The integrity-ordering invariant is wired HERE for real: any autonomous
// spend request goes through assertAutonomousSpendAllowed(), which throws
// until the Recognition Gateway (0003) and PledgeGate (0005) exist as live
// hosted services. In this beta that is always — by design.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  assertAutonomousSpendAllowed,
  type Capability,
} from "@leonardo/shared";

const PROMPT_TIMEOUT_MS = Number(process.env.AGENT_PROMPT_TIMEOUT_MS ?? 180_000);

function rootDir(): string {
  return process.env.AGENT_RUNNER_ROOT ?? join(homedir(), ".leonardo-platform", "agents");
}
function seedDir(): string {
  return process.env.AGENT_SEED_PROFILE ?? join(homedir(), ".hermes", "profiles", "leonardo");
}

function safeWallet(wallet: string): string {
  const w = wallet.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(w)) throw new Error("invalid wallet");
  return w;
}

export function agentPaths(wallet: string): { base: string; home: string; workspace: string; meta: string } {
  const base = join(rootDir(), safeWallet(wallet));
  return { base, home: join(base, "home"), workspace: join(base, "workspace"), meta: join(base, "meta.json") };
}

export type AgentStatus = {
  provisioned: boolean;
  createdAt?: string;
  prompts?: number;
  lastPromptAt?: string;
};

export function agentStatus(wallet: string): AgentStatus {
  const p = agentPaths(wallet);
  if (!existsSync(p.meta)) return { provisioned: false };
  try {
    const meta = JSON.parse(readFileSync(p.meta, "utf8")) as { created_at: string; prompts: number; last_prompt_at?: string };
    return { provisioned: true, createdAt: meta.created_at, prompts: meta.prompts, lastPromptAt: meta.last_prompt_at };
  } catch {
    return { provisioned: true };
  }
}

/** Create the agent's isolated home + workspace, seeded with platform creds. */
export function provisionAgent(wallet: string): AgentStatus {
  const p = agentPaths(wallet);
  if (existsSync(p.meta)) return agentStatus(wallet);
  mkdirSync(p.home, { recursive: true, mode: 0o700 });
  mkdirSync(p.workspace, { recursive: true, mode: 0o700 });
  for (const f of ["config.yaml", "auth.json", ".env"]) {
    const src = join(seedDir(), f);
    if (existsSync(src)) cpSync(src, join(p.home, f));
  }
  writeFileSync(p.meta, JSON.stringify({ wallet: safeWallet(wallet), created_at: new Date().toISOString(), prompts: 0 }), "utf8");
  return agentStatus(wallet);
}

export function destroyAgent(wallet: string): void {
  rmSync(agentPaths(wallet).base, { recursive: true, force: true });
}

/** Test seam: how a prompt is actually executed (real = hermes subprocess). */
export type PromptExec = (opts: { home: string; workspace: string; prompt: string }) => Promise<string>;

const realPromptExec: PromptExec = ({ home, workspace, prompt }) =>
  new Promise((resolve, reject) => {
    const child = spawn("hermes", ["-z", prompt], {
      cwd: workspace,
      env: { ...process.env, HERMES_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("agent timed out"));
    }, PROMPT_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`agent exited ${code}: ${err.slice(-200)}`));
    });
  });

/** Run one prompt inside the wallet's isolated agent. */
export async function promptAgent(
  wallet: string,
  prompt: string,
  exec: PromptExec = realPromptExec,
): Promise<{ reply: string; ms: number }> {
  const p = agentPaths(wallet);
  if (!existsSync(p.meta)) throw new Error("agent not provisioned");
  const t0 = Date.now();
  const reply = await exec({ home: p.home, workspace: p.workspace, prompt: prompt.slice(0, 4000) });
  try {
    const meta = JSON.parse(readFileSync(p.meta, "utf8")) as { prompts?: number } & Record<string, unknown>;
    meta.prompts = (meta.prompts ?? 0) + 1;
    meta.last_prompt_at = new Date().toISOString();
    writeFileSync(p.meta, JSON.stringify(meta), "utf8");
  } catch {
    // counters are best-effort
  }
  return { reply, ms: Date.now() - t0 };
}

/** What is actually live as a hosted service today (no 0003, no 0005). */
export function liveCapabilities(): Capability[] {
  return [
    { canon: "CANON-01v2-0001", name: "Agent Passport / authenticated memory precedence", claim: "hosted_service" },
    { canon: "CANON-01v2-0006", name: "Local Liveness Gate", claim: "containment_scaffold" },
    { canon: "CANON-01v2-0007", name: "Observation Receipts / Workshop governance evaluator", claim: "capability_module" },
  ];
}

/**
 * Autonomous-spend request: ALWAYS blocked in beta — the integrity-ordering
 * invariant requires Recognition Gateway (0003) + PledgeGate (0005) live first.
 * Throws IntegrityError.
 */
export function requestAutonomousSpend(wallet: string, _amountUsd: number): never {
  safeWallet(wallet);
  assertAutonomousSpendAllowed(liveCapabilities());
  // Unreachable today by design: the assert above throws until 0003+0005 ship.
  throw new Error("unreachable");
}

export function listAgents(): string[] {
  try {
    return readdirSync(rootDir()).filter((d) => /^0x[0-9a-f]{40}$/.test(d));
  } catch {
    return [];
  }
}
