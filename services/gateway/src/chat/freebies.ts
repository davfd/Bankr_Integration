// The free tier: every signed-in wallet gets N free chat prompts; after that
// the x402 paywall takes over. Identity comes from the web app's HOLDER-verified
// session token forwarded in the x-leo-session header. The versioned envelope is
// deliberately incompatible with the old `wallet.exp.sig` beta tokens, so stale
// localStorage sessions from the pre-holder-gate era cannot call gateway APIs.
// Counts persist to a JSON file so a gateway restart doesn't re-grant freebies.
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export const FREE_PROMPTS = Number(process.env.FREE_PROMPTS ?? 5);
export const SESSION_TOKEN_VERSION = "leo2";
export const SESSION_TOKEN_PURPOSE = "holder";

// Resolved at use time (not module load) so tests can point it elsewhere.
function storePath(): string {
  return process.env.FREEBIE_STORE ?? join(homedir(), ".leonardo-platform", "freebies.json");
}

function sessionPayload(wallet: string, expMs: number | string): string {
  return `${SESSION_TOKEN_VERSION}.${wallet.toLowerCase()}.${expMs}.${SESSION_TOKEN_PURPOSE}`;
}

export function createSessionToken(wallet: string, expMs = Date.now() + 60_000, secret = process.env.SESSION_SECRET): string {
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const payload = sessionPayload(wallet, expMs);
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/** Verify the holder-session token (`leo2.<wallet>.<exp>.holder.<hmac>`) → wallet or null. */
export function verifySessionToken(value: string | undefined): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!value || !secret) return null;
  const parts = value.split(".");
  if (parts.length !== 5) return null;
  const [version, wallet, exp, purpose, sig] = parts as [string, string, string, string, string];
  if (version !== SESSION_TOKEN_VERSION || purpose !== SESSION_TOKEN_PURPOSE) return null;
  const expected = createHmac("sha256", secret).update(sessionPayload(wallet, exp)).digest("hex");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const expiry = Number(exp);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return null;
  return wallet.toLowerCase();
}

function load(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(storePath(), "utf8")) as Record<string, number>;
  } catch {
    return {};
  }
}

let used: Record<string, number> | null = null;
function counts(): Record<string, number> {
  used ??= load();
  return used;
}

function persist(): void {
  try {
    mkdirSync(dirname(storePath()), { recursive: true });
    writeFileSync(storePath(), JSON.stringify(counts()), "utf8");
  } catch {
    // metering must never fail the request
  }
}

export function freeRemaining(wallet: string): number {
  return Math.max(0, FREE_PROMPTS - (counts()[wallet.toLowerCase()] ?? 0));
}

export function consumeFree(wallet: string): number {
  const w = wallet.toLowerCase();
  counts()[w] = (counts()[w] ?? 0) + 1;
  persist();
  return freeRemaining(w);
}

/** Test hook: reset in-memory state (and point FREEBIE_STORE somewhere fresh). */
export function _resetFreebies(): void {
  used = null;
}
