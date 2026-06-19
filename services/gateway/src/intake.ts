import { createHash, createHmac, randomUUID } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type IntakeKind = "council_plan" | "council_audit" | "workshop_brief" | "workshop_reproduction" | "workshop_build";

export type IntakeRequest = {
  id: string;
  kind: IntakeKind;
  status: "queued";
  wallet: string;
  title: string;
  target?: string;
  created_at: string;
  receipt_sha256: string;
  receipt: IntakeReceipt;
};

export type IntakeReceipt = {
  version: "leo-intake-v1";
  request_id: string;
  kind: IntakeKind;
  wallet: string;
  title: string;
  target?: string;
  brief_commitment_sha256: string;
  brief_commitment_scheme: "hmac-sha256:leo-intake-brief-v1";
  created_at: string;
  purchased: "intake_queue_slot" | "workshop_intake_slot";
  boundary: string;
};

type IntakeInput = {
  wallet: string;
  kind: IntakeKind;
  title?: unknown;
  brief?: unknown;
  target?: unknown;
};

export class IntakeValidationError extends Error {}
export class IntakeUnavailableError extends Error {}

const TITLE_MAX = 160;
const BRIEF_MAX = 4000;
const TARGET_MAX = 500;
const LEDGER_CAP = 200;
const LOCK_ATTEMPTS = 50;
const LOCK_WAIT_MS = 10;
const LOCK_STALE_MS = 5 * 60_000;
const BRIEF_COMMITMENT_SCHEME = "hmac-sha256:leo-intake-brief-v1" as const;

function root(): string {
  return process.env.INTAKE_ROOT ?? join(homedir(), ".leonardo-platform", "intake");
}

function ensureRoot(): string {
  const dir = root();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

function safeWallet(wallet: string): string {
  const w = wallet.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(w)) throw new IntakeValidationError("invalid wallet");
  return w;
}

function cleanString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function intakeReceiptSecret(): string {
  const secret = process.env.INTAKE_RECEIPT_SECRET;
  if (!secret) throw new Error("intake receipt secret missing");
  return secret;
}

function briefCommitment(input: { request_id: string; wallet: string; kind: IntakeKind; brief: string }): string {
  return createHmac("sha256", intakeReceiptSecret()).update(JSON.stringify(input)).digest("hex");
}

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

type WalletLock = { lockFile: string; token: string };

function lockPayload(token: string): string {
  return JSON.stringify({ token, pid: process.pid, created_at: Date.now() });
}

function parseLockPayload(raw: string): { token?: string; created_at?: number } {
  try {
    const parsed = JSON.parse(raw) as { token?: unknown; created_at?: unknown };
    return {
      token: typeof parsed.token === "string" ? parsed.token : undefined,
      created_at: typeof parsed.created_at === "number" && Number.isFinite(parsed.created_at) ? parsed.created_at : undefined,
    };
  } catch {
    return {};
  }
}

function lockAgeMs(lockFile: string): number {
  const raw = readFileSync(lockFile, "utf8");
  const parsed = parseLockPayload(raw);
  return Date.now() - (parsed.created_at ?? statSync(lockFile).mtimeMs);
}

function clearStaleLockFile(lockFile: string): boolean {
  try {
    if (lockAgeMs(lockFile) <= LOCK_STALE_MS) return false;
    unlinkSync(lockFile);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw e;
  }
}

function lockFileExists(file: string): boolean {
  try {
    statSync(file);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

function tryAcquireWalletLock(lockFile: string, breakerFile?: string): WalletLock | null {
  if (breakerFile && lockFileExists(breakerFile)) {
    clearStaleLockFile(breakerFile);
    if (lockFileExists(breakerFile)) return null;
  }
  const token = randomUUID();
  const claimFile = `${lockFile}.${process.pid}.${token}.claim`;
  writeFileSync(claimFile, lockPayload(token), { encoding: "utf8", mode: 0o600 });
  try {
    if (breakerFile && lockFileExists(breakerFile)) {
      clearStaleLockFile(breakerFile);
      if (lockFileExists(breakerFile)) return null;
    }
    linkSync(claimFile, lockFile);
    return { lockFile, token };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw e;
    return null;
  } finally {
    try {
      unlinkSync(claimFile);
    } catch {
      // claim file may have been removed during cleanup after a partial failure.
    }
  }
}

function maybeBreakStaleLock(lockFile: string, breakerFile: string): boolean {
  const breaker = tryAcquireWalletLock(breakerFile);
  if (!breaker) return false;
  try {
    let ageMs = 0;
    try {
      const raw = readFileSync(lockFile, "utf8");
      const parsed = parseLockPayload(raw);
      ageMs = Date.now() - (parsed.created_at ?? statSync(lockFile).mtimeMs);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw e;
    }
    if (ageMs <= LOCK_STALE_MS) return false;

    const staleFile = `${lockFile}.stale.${process.pid}.${randomUUID()}`;
    try {
      renameSync(lockFile, staleFile);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw e;
    }
    try {
      unlinkSync(staleFile);
    } catch {
      // The stale file was already cleared.
    }
    return true;
  } finally {
    releaseWalletLock(breaker);
  }
}

function releaseWalletLock({ lockFile, token }: WalletLock): void {
  try {
    const current = parseLockPayload(readFileSync(lockFile, "utf8"));
    if (current.token === token) unlinkSync(lockFile);
  } catch {
    // If a crash/manual cleanup/stale-break removed it, never remove another writer's lock.
  }
}

function withWalletLedgerLock<T>(wallet: string, fn: () => T): T {
  const dir = ensureRoot();
  const lockFile = join(dir, `${wallet}.lock`);
  const breakerFile = `${lockFile}.break`;
  let lock: WalletLock | null = null;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    lock = tryAcquireWalletLock(lockFile, breakerFile);
    if (lock) break;
    maybeBreakStaleLock(lockFile, breakerFile);
    if (attempt === LOCK_ATTEMPTS - 1) throw new IntakeUnavailableError("intake ledger lock unavailable");
    sleepSync(LOCK_WAIT_MS);
  }
  if (!lock) throw new IntakeUnavailableError("intake ledger lock unavailable");
  try {
    return fn();
  } finally {
    releaseWalletLock(lock);
  }
}

function writeJsonAtomic(file: string, value: unknown): void {
  const tmpFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmpFile, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
    renameSync(tmpFile, file);
    chmodSync(file, 0o600);
  } catch (e) {
    try {
      unlinkSync(tmpFile);
    } catch {
      // If write failed before creation or another cleanup won the race, there is no temp file to remove.
    }
    throw e;
  }
}

function walletLedgerFile(wallet: string): string {
  return join(ensureRoot(), `${wallet}.json`);
}

function repairWalletLedgerFile(file: string): void {
  try {
    const st = statSync(file);
    if (st.isDirectory()) throw new IntakeUnavailableError("intake ledger path unavailable");
    if (st.isFile()) chmodSync(file, 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
}

export function assertIntakeReady(wallet: string): string {
  const safe = safeWallet(wallet);
  intakeReceiptSecret();
  repairWalletLedgerFile(walletLedgerFile(safe));
  return safe;
}

function storeRequest(req: IntakeRequest): void {
  const file = walletLedgerFile(req.wallet);
  withWalletLedgerLock(req.wallet, () => {
    let list: IntakeRequest[] = [];
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
      list = Array.isArray(parsed) ? parsed.map((entry) => publicSafeRequest(entry, req.wallet)).filter((entry): entry is IntakeRequest => Boolean(entry)) : [];
    } catch {
      list = [];
    }
    list.push(req);
    writeJsonAtomic(file, list.slice(-LEDGER_CAP));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIntakeKind(value: unknown): value is IntakeKind {
  return value === "council_plan" || value === "council_audit" || value === "workshop_brief" || value === "workshop_reproduction" || value === "workshop_build";
}

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function publicSafeReceipt(value: unknown, fallback: { id: string; kind: IntakeKind; wallet: string; title: string; target?: string; created_at: string }): IntakeReceipt | null {
  if (!isRecord(value)) return null;
  const version = value.version === "leo-intake-v1" ? "leo-intake-v1" : null;
  const request_id = typeof value.request_id === "string" ? value.request_id : fallback.id;
  const kind = isIntakeKind(value.kind) ? value.kind : fallback.kind;
  const receiptWallet = typeof value.wallet === "string" ? value.wallet.toLowerCase() : fallback.wallet;
  const title = cleanOptionalString(value.title) ?? fallback.title;
  const target = cleanOptionalString(value.target) ?? fallback.target;
  const created_at = cleanOptionalString(value.created_at) ?? fallback.created_at;
  const purchased = value.purchased === "workshop_intake_slot" ? "workshop_intake_slot" : "intake_queue_slot";
  const boundary = cleanOptionalString(value.boundary) ?? "Receipt sanitized from legacy intake ledger.";
  if (!version || receiptWallet !== fallback.wallet || request_id !== fallback.id) return null;

  const receipt: Record<string, unknown> = { version, request_id, kind, wallet: fallback.wallet, title };
  if (target) receipt.target = target;
  if (typeof value.brief_commitment_sha256 === "string" && /^[a-f0-9]{64}$/i.test(value.brief_commitment_sha256)) {
    receipt.brief_commitment_sha256 = value.brief_commitment_sha256.toLowerCase();
  }
  if (value.brief_commitment_scheme === BRIEF_COMMITMENT_SCHEME) receipt.brief_commitment_scheme = BRIEF_COMMITMENT_SCHEME;
  receipt.created_at = created_at;
  receipt.purchased = purchased;
  receipt.boundary = boundary;
  return receipt as IntakeReceipt;
}

function publicSafeRequest(value: unknown, wallet: string): IntakeRequest | null {
  if (!isRecord(value)) return null;
  const requestWallet = typeof value.wallet === "string" ? value.wallet.toLowerCase() : "";
  const id = typeof value.id === "string" ? value.id : "";
  const kind = isIntakeKind(value.kind) ? value.kind : null;
  const title = cleanOptionalString(value.title);
  const target = cleanOptionalString(value.target);
  const created_at = cleanOptionalString(value.created_at);
  if (requestWallet !== wallet || !id || !kind || value.status !== "queued" || !title || !created_at) return null;
  const receipt = publicSafeReceipt(value.receipt, { id, kind, wallet, title, target, created_at });
  if (!receipt) return null;
  return {
    id,
    kind,
    status: "queued",
    wallet,
    title,
    ...(target ? { target } : {}),
    created_at,
    receipt,
    receipt_sha256: hashJson(receipt),
  };
}

function loadWalletRequests(wallet: string): IntakeRequest[] {
  const safe = safeWallet(wallet);
  const file = walletLedgerFile(safe);
  repairWalletLedgerFile(file);
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((req) => publicSafeRequest(req, safe)).filter((req): req is IntakeRequest => Boolean(req));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

export function listIntakeRequests(wallet: string): IntakeRequest[] {
  return loadWalletRequests(wallet);
}

export function getIntakeRequest(wallet: string, id: string): IntakeRequest | null {
  if (!/^intake_[A-Za-z0-9_-]+$/.test(id)) return null;
  return loadWalletRequests(wallet).find((req) => req.id === id) ?? null;
}

export function createIntakeRequest(input: IntakeInput): IntakeRequest {
  const wallet = safeWallet(input.wallet);
  const title = cleanString(input.title, TITLE_MAX);
  const brief = cleanString(input.brief, BRIEF_MAX);
  const target = cleanString(input.target, TARGET_MAX) || undefined;
  if (!title || !brief) throw new IntakeValidationError("title and brief required");

  const id = `intake_${randomUUID()}`;
  const created_at = new Date().toISOString();
  const purchased = input.kind.startsWith("workshop_") ? "workshop_intake_slot" : "intake_queue_slot";
  const witness = " Receipt exposes a server-keyed commitment to the brief; no public unsalted brief hash, raw brief, or private text is exposed.";
  const boundary = input.kind.startsWith("council_")
    ? `Payment/staking buys Council intake and queue access only; it does not buy verdict, truth, pass, safety clearance, Council outcome, Scripture interpretation, agent authority, or reputation.${witness}`
    : `Payment/staking buys Workshop intake and queue access only; it does not buy result, truth, implementation success, safety clearance, acceptance, Scripture interpretation, agent authority, or reputation.${witness}`;

  const receipt: IntakeReceipt = {
    version: "leo-intake-v1",
    request_id: id,
    kind: input.kind,
    wallet,
    title,
    ...(target ? { target } : {}),
    brief_commitment_sha256: briefCommitment({ request_id: id, wallet, kind: input.kind, brief }),
    brief_commitment_scheme: BRIEF_COMMITMENT_SCHEME,
    created_at,
    purchased,
    boundary,
  };
  const req: IntakeRequest = {
    id,
    kind: input.kind,
    status: "queued",
    wallet,
    title,
    ...(target ? { target } : {}),
    created_at,
    receipt,
    receipt_sha256: hashJson(receipt),
  };
  storeRequest(req);
  return req;
}
