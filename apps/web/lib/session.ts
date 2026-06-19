// Wallet-session helpers, shared by the edge middleware (verify) and the Node
// API route (create). Stateless: a server-HMAC-signed cookie carries the
// authenticated, holder-verified wallet address — no DB needed for the beta.

const enc = new TextEncoder();

// v2: renamed to HARD-INVALIDATE every session cookie minted before token-gating
// (incl. the owner-override era). Old `leo_session` cookies are now unrecognized,
// so everyone must re-sign-in through /api/auth — which is pure $LEO gating.
export const SESSION_COOKIE = "leo_session_v2";
const TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
export const SESSION_TOKEN_VERSION = "leo2";
export const SESSION_TOKEN_PURPOSE = "holder";

// Token-holding re-check cache. The middleware re-verifies $LEO holdings (not just
// the session signature) but caches the positive result here for a short window
// so it doesn't hit the chain on every request. Separate from leo_session so the
// gateway's 3-part token parser is unaffected.
// v2: renamed to invalidate all gate caches minted while the owner-override was
// active, forcing an immediate on-chain re-check for every current session.
export const GATE_COOKIE = "leo_gate2";
export const GATE_RECHECK_MS = 1000 * 60 * 10; // re-verify holdings every 10 min

// Allowlist is OPT-IN: when ALLOWED_WALLETS (csv) is set, only those wallets
// may sign in; unset = any wallet may sign in and pay per use. (Kept set during
// the private beta — unsetting it is the launch switch.)
export function allowedWallets(): Set<string> | null {
  const raw = (process.env.ALLOWED_WALLETS ?? "").trim();
  if (!raw) return null;
  return new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

export function isAllowed(address: string): boolean {
  const set = allowedWallets();
  return set === null || set.has(address.toLowerCase());
}

function sessionPayload(address: string, exp: string | number): string {
  return `${SESSION_TOKEN_VERSION}.${address.toLowerCase()}.${exp}.${SESSION_TOKEN_PURPOSE}`;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(data: string): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function createSession(address: string): Promise<string> {
  const addr = address.toLowerCase();
  const exp = String(Date.now() + TTL_MS);
  const payload = sessionPayload(addr, exp);
  const sig = await hmacHex(payload);
  return `${payload}.${sig}`;
}

/** Returns the authenticated address if the cookie is valid and fresh.
 *  The version/purpose fields make old pre-holder-gate `wallet.exp.sig` tokens
 *  fail closed both in the web app and in the gateway x-leo-session verifier. */
export async function verifySession(value: string | undefined): Promise<string | null> {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 5) return null;
  const [version, addr, exp, purpose, sig] = parts;
  if (version !== SESSION_TOKEN_VERSION || purpose !== SESSION_TOKEN_PURPOSE) return null;
  if (!safeEqual(sig, await hmacHex(sessionPayload(addr, exp)))) return null;
  const expiry = Number(exp);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return null;
  return addr;
}

/** Mint a short-lived "token-holding verified" marker for `wallet`, good until
 *  `until` (epoch ms). HMAC-signed so it can't be forged. */
export async function signGate(wallet: string, until: number): Promise<string> {
  const w = wallet.toLowerCase();
  const sig = await hmacHex(`gate.${w}.${until}`);
  return `${w}.${until}.${sig}`;
}

/** Verify a gate marker → { wallet, until } when valid and unexpired, else null. */
export async function verifyGate(value: string | undefined): Promise<{ wallet: string; until: number } | null> {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [w, until, sig] = parts;
  if (!safeEqual(sig, await hmacHex(`gate.${w}.${until}`))) return null;
  const u = Number(until);
  if (!Number.isFinite(u) || Date.now() > u) return null;
  return { wallet: w, until: u };
}
