import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const ALLOWED_MCP_SCOPES = ["graph:read", "scripture:read", "council_memory:read", "base_mcp:governed"] as const;
export type McpScope = (typeof ALLOWED_MCP_SCOPES)[number];

export type McpTokenRecord = {
  id: string;
  wallet: string;
  label: string;
  tokenHash: string;
  scopes: McpScope[];
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  lastUsedTool: string | null;
};

export type McpTokenPublic = Omit<McpTokenRecord, "tokenHash">;

export type CreateMcpTokenInput = {
  wallet: string;
  label?: string;
  scopes?: string[];
  expiresInDays?: number | null;
  expiresAt?: string | null;
};

export type CreateMcpTokenResult = { token: string; record: McpTokenPublic };

export type VerifyMcpTokenResult =
  | { ok: true; record: McpTokenRecord }
  | { ok: false; code: "missing" | "malformed" | "invalid" | "revoked" | "expired" | "insufficient_scope" };

const TOKEN_RE = /^leo_mcp_([a-f0-9]{18})_([A-Za-z0-9_-]{32,})$/;
export const DEFAULT_MCP_TOKEN_EXPIRY_DAYS = 2; // beta access tokens last 48 hours by default
const DEFAULT_SCOPE: McpScope = "graph:read";

let cached: McpTokenRecord[] | null = null;

function storePath(): string {
  return process.env.MCP_TOKEN_STORE ?? join(homedir(), ".leonardo-platform", "mcp-tokens", "tokens.json");
}

function secret(): string {
  const s = process.env.MCP_TOKEN_SECRET;
  if (!s) throw new Error("MCP_TOKEN_SECRET is required for MCP token hashing");
  if (process.env.SESSION_SECRET && s === process.env.SESSION_SECRET) {
    throw new Error("MCP_TOKEN_SECRET must be distinct from SESSION_SECRET");
  }
  return s;
}

function load(): McpTokenRecord[] {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(readFileSync(storePath(), "utf8")) as unknown;
    cached = Array.isArray(parsed) ? (parsed as McpTokenRecord[]) : [];
  } catch {
    cached = [];
  }
  return cached;
}

function persist(): void {
  const p = storePath();
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify(load(), null, 2), { encoding: "utf8", mode: 0o600 });
}

function b64url(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function hashToken(token: string): string {
  return createHmac("sha256", secret()).update(token).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const aa = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function publicRecord(r: McpTokenRecord): McpTokenPublic {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tokenHash, ...rest } = r;
  return { ...rest };
}

export function normalizeMcpScopes(scopes: string[] | undefined): McpScope[] {
  const input = scopes && scopes.length > 0 ? scopes : [DEFAULT_SCOPE];
  const out: McpScope[] = [];
  for (const scope of input) {
    if (!ALLOWED_MCP_SCOPES.includes(scope as McpScope)) throw new Error(`unsupported scope: ${scope}`);
    if (!out.includes(scope as McpScope)) out.push(scope as McpScope);
  }
  return out;
}

function cleanLabel(label: string | undefined): string {
  const l = (label ?? "Agent token").trim().replace(/\s+/g, " ").slice(0, 80);
  return l || "Agent token";
}

function expiry(input: CreateMcpTokenInput): string | null {
  if (Object.prototype.hasOwnProperty.call(input, "expiresAt")) return input.expiresAt ?? null;
  const days = input.expiresInDays === null || input.expiresInDays === undefined ? DEFAULT_MCP_TOKEN_EXPIRY_DAYS : input.expiresInDays;
  if (days === null) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function createMcpToken(input: CreateMcpTokenInput): CreateMcpTokenResult {
  const wallet = input.wallet.toLowerCase();
  const id = randomBytes(9).toString("hex");
  const token = `leo_mcp_${id}_${b64url(32)}`;
  const now = new Date().toISOString();
  const rec: McpTokenRecord = {
    id,
    wallet,
    label: cleanLabel(input.label),
    tokenHash: hashToken(token),
    scopes: normalizeMcpScopes(input.scopes),
    createdAt: now,
    expiresAt: expiry(input),
    revokedAt: null,
    lastUsedAt: null,
    lastUsedTool: null,
  };
  const records = load();
  for (const existing of records) {
    if (existing.wallet === wallet && !existing.revokedAt) existing.revokedAt = now;
  }
  records.push(rec);
  persist();
  return { token, record: publicRecord(rec) };
}

export function listMcpTokens(wallet: string): McpTokenPublic[] {
  const w = wallet.toLowerCase();
  return load().filter((r) => r.wallet === w).map(publicRecord);
}

export function revokeMcpToken(wallet: string, id: string): boolean {
  const w = wallet.toLowerCase();
  const rec = load().find((r) => r.wallet === w && r.id === id);
  if (!rec) return false;
  if (!rec.revokedAt) rec.revokedAt = new Date().toISOString();
  persist();
  return true;
}

export function rotateMcpToken(wallet: string, id: string): CreateMcpTokenResult | null {
  const w = wallet.toLowerCase();
  const rec = load().find((r) => r.wallet === w && r.id === id);
  if (!rec) return null;
  revokeMcpToken(w, id);
  return createMcpToken({ wallet: w, label: rec.label, scopes: rec.scopes, expiresAt: rec.expiresAt });
}

export function verifyMcpToken(token: string | undefined, requiredScope: string | string[] = DEFAULT_SCOPE, tool?: string): VerifyMcpTokenResult {
  if (!token) return { ok: false, code: "missing" };
  const match = TOKEN_RE.exec(token);
  if (!match) return { ok: false, code: "malformed" };
  const id = match[1];
  if (!id) return { ok: false, code: "malformed" };
  let tokenHash: string;
  try {
    tokenHash = hashToken(token);
  } catch {
    return { ok: false, code: "invalid" };
  }
  const rec = load().find((r) => r.id === id && safeEqualHex(r.tokenHash, tokenHash));
  if (!rec) return { ok: false, code: "invalid" };
  if (rec.revokedAt) return { ok: false, code: "revoked" };
  if (rec.expiresAt && Date.now() > Date.parse(rec.expiresAt)) return { ok: false, code: "expired" };
  const required = Array.isArray(requiredScope) ? requiredScope : [requiredScope];
  if (!required.some((scope) => rec.scopes.includes(scope as McpScope))) return { ok: false, code: "insufficient_scope" };
  rec.lastUsedAt = new Date().toISOString();
  rec.lastUsedTool = tool ?? null;
  persist();
  return { ok: true, record: rec };
}

export function _resetMcpTokens(): void {
  cached = null;
}
