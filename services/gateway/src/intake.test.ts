import { createHash, createHmac } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIntakeRequest, listIntakeRequests } from "./intake";

const TEST_WALLET = "0xabc0000000000000000000000000000000000001";
const TEST_SECRET = "intake-test-secret";
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "leo-intake-unit-"));
  process.env.INTAKE_ROOT = root;
  process.env.INTAKE_RECEIPT_SECRET = TEST_SECRET;
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
  delete process.env.INTAKE_ROOT;
  delete process.env.INTAKE_RECEIPT_SECRET;
  delete process.env.SESSION_SECRET;
});

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

describe("intake receipt ledger", () => {
  it("uses a server-keyed brief commitment rather than a public unsalted brief hash", () => {
    const req = createIntakeRequest({
      wallet: TEST_WALLET,
      kind: "council_plan",
      title: "Council plan intake",
      brief: "short secret brief",
    });

    const expected = createHmac("sha256", TEST_SECRET)
      .update(JSON.stringify({ request_id: req.id, wallet: TEST_WALLET, kind: "council_plan", brief: "short secret brief" }))
      .digest("hex");

    expect(req.receipt.brief_commitment_scheme).toBe("hmac-sha256:leo-intake-brief-v1");
    expect(req.receipt.brief_commitment_sha256).toBe(expected);
    expect(req.receipt).not.toHaveProperty("brief_sha256");
    expect(JSON.stringify(req)).not.toContain("short secret brief");
    expect(req.receipt.boundary).toMatch(/server-keyed commitment/i);
  });

  it("requires a dedicated intake receipt secret instead of falling back to the session signing secret", () => {
    delete process.env.INTAKE_RECEIPT_SECRET;
    process.env.SESSION_SECRET = "session-only-test-value";

    expect(() => createIntakeRequest({
      wallet: TEST_WALLET,
      kind: "council_plan",
      title: "Council plan intake",
      brief: "private brief",
    })).toThrow(/intake receipt secret/i);

    const source = readFileSync(join(process.cwd(), "services/gateway/src/intake.ts"), "utf8");
    expect(source).not.toContain("process.env.SESSION_SECRET");
  });

  it("re-hashes legacy ledger receipts after stripping public unsalted brief hashes", () => {
    const legacyReceipt = {
      version: "leo-intake-v1",
      request_id: "intake_legacy",
      kind: "council_plan",
      wallet: TEST_WALLET,
      title: "legacy plan",
      brief_sha256: hashJson({ brief: "short secret brief" }),
      created_at: new Date(0).toISOString(),
      purchased: "intake_queue_slot",
      boundary: "old boundary",
    };
    const legacy = {
      id: "intake_legacy",
      kind: "council_plan",
      status: "queued",
      wallet: TEST_WALLET,
      title: "legacy plan",
      created_at: legacyReceipt.created_at,
      receipt: legacyReceipt,
      receipt_sha256: hashJson(legacyReceipt),
    };
    writeFileSync(join(root, `${TEST_WALLET}.json`), JSON.stringify([legacy]), "utf8");

    const [listed] = listIntakeRequests(TEST_WALLET);
    expect(listed).toBeTruthy();
    expect(listed!.receipt).not.toHaveProperty("brief_sha256");
    expect(listed!.receipt_sha256).not.toBe(legacy.receipt_sha256);
    expect(listed!.receipt_sha256).toBe(hashJson(listed!.receipt));
  });

  it("returns legacy/corrupt ledger entries through an explicit public schema allowlist", () => {
    const legacy = {
      id: "intake_legacy_private",
      kind: "council_plan",
      status: "queued",
      wallet: TEST_WALLET,
      title: "legacy plan",
      target: "https://example.com/artifact",
      created_at: new Date(0).toISOString(),
      brief: "TOP LEVEL PRIVATE BRIEF",
      private_notes: "TOP LEVEL PRIVATE NOTES",
      receipt_sha256: "old-hash",
      receipt: {
        version: "leo-intake-v1",
        request_id: "intake_legacy_private",
        kind: "council_plan",
        wallet: TEST_WALLET,
        title: "legacy plan",
        target: "https://example.com/artifact",
        brief: "RECEIPT PRIVATE BRIEF",
        raw_private_text: "RECEIPT PRIVATE RAW",
        brief_sha256: hashJson({ brief: "short secret brief" }),
        created_at: new Date(0).toISOString(),
        purchased: "intake_queue_slot",
        boundary: "old boundary",
      },
    };
    writeFileSync(join(root, `${TEST_WALLET}.json`), JSON.stringify([legacy]), "utf8");

    const [listed] = listIntakeRequests(TEST_WALLET);
    const publicJson = JSON.stringify(listed);
    expect(publicJson).not.toContain("PRIVATE BRIEF");
    expect(publicJson).not.toContain("PRIVATE NOTES");
    expect(publicJson).not.toContain("PRIVATE RAW");
    expect(listed).toEqual({
      id: "intake_legacy_private",
      kind: "council_plan",
      status: "queued",
      wallet: TEST_WALLET,
      title: "legacy plan",
      target: "https://example.com/artifact",
      created_at: legacy.created_at,
      receipt_sha256: hashJson(listed!.receipt),
      receipt: {
        version: "leo-intake-v1",
        request_id: "intake_legacy_private",
        kind: "council_plan",
        wallet: TEST_WALLET,
        title: "legacy plan",
        target: "https://example.com/artifact",
        created_at: legacy.created_at,
        purchased: "intake_queue_slot",
        boundary: "old boundary",
      },
    });
  });

  it("repairs existing read-path intake root and wallet ledger file permissions", () => {
    const legacyReceipt = {
      version: "leo-intake-v1",
      request_id: "intake_perm",
      kind: "council_plan",
      wallet: TEST_WALLET,
      title: "legacy plan",
      created_at: new Date(0).toISOString(),
      purchased: "intake_queue_slot",
      boundary: "old boundary",
    };
    const file = join(root, `${TEST_WALLET}.json`);
    writeFileSync(file, JSON.stringify([{
      id: "intake_perm",
      kind: "council_plan",
      status: "queued",
      wallet: TEST_WALLET,
      title: "legacy plan",
      created_at: legacyReceipt.created_at,
      receipt: legacyReceipt,
      receipt_sha256: hashJson(legacyReceipt),
    }]), { encoding: "utf8", mode: 0o644 });
    chmodSync(root, 0o755);
    chmodSync(file, 0o644);

    expect(listIntakeRequests(TEST_WALLET)).toHaveLength(1);
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("uses a token-owned wallet ledger lock and atomic rename instead of blind unlink/overwrite", () => {
    const source = readFileSync(join(process.cwd(), "services/gateway/src/intake.ts"), "utf8");
    expect(source).toContain("withWalletLedgerLock");
    expect(source).toContain("linkSync(claimFile, lockFile)");
    expect(source).toContain("const breakerFile = `${lockFile}.break`");
    expect(source).toContain("tryAcquireWalletLock(breakerFile)");
    expect(source).toContain("if (breakerFile && lockFileExists(breakerFile))");
    expect(source).toContain("clearStaleLockFile(breakerFile)");
    expect(source).toContain("current.token === token");
    expect(source).toContain("renameSync(tmpFile, file)");
    expect(source).not.toContain("writeFileSync(file, JSON.stringify(list.slice(-200)), \"utf8\")");
  });

  it("cleans up lock and temp files after writing a request", () => {
    const req = createIntakeRequest({
      wallet: TEST_WALLET,
      kind: "workshop_reproduction",
      title: "Workshop reproduction intake",
      brief: "private reproduction brief",
    });

    expect(listIntakeRequests(TEST_WALLET).map((r) => r.id)).toContain(req.id);
    expect(existsSync(join(root, `${TEST_WALLET}.lock`))).toBe(false);
    const leftovers = readFileSync(join(root, `${TEST_WALLET}.json`), "utf8");
    expect(leftovers).toContain(req.id);
  });

  it("repairs an existing intake root to private directory permissions", () => {
    chmodSync(root, 0o777);

    createIntakeRequest({
      wallet: TEST_WALLET,
      kind: "council_plan",
      title: "Council plan intake",
      brief: "private brief",
    });

    expect(statSync(root).mode & 0o777).toBe(0o700);
  });

  it("recovers from a stale wallet ledger lock instead of blocking future intake", () => {
    const lockFile = join(root, `${TEST_WALLET}.lock`);
    writeFileSync(lockFile, "stale lock from crashed writer", "utf8");
    const stale = new Date(Date.now() - 10 * 60_000);
    utimesSync(lockFile, stale, stale);

    const req = createIntakeRequest({
      wallet: TEST_WALLET,
      kind: "council_audit",
      title: "Council audit intake",
      brief: "private audit brief",
    });

    expect(listIntakeRequests(TEST_WALLET).map((r) => r.id)).toContain(req.id);
    expect(existsSync(lockFile)).toBe(false);
  });

  it("recovers from a stale wallet ledger breaker left by a crashed stale-lock repair", () => {
    const breakerFile = join(root, `${TEST_WALLET}.lock.break`);
    writeFileSync(breakerFile, JSON.stringify({ token: "crashed-breaker", pid: 1, created_at: Date.now() - 10 * 60_000 }), "utf8");
    const stale = new Date(Date.now() - 10 * 60_000);
    utimesSync(breakerFile, stale, stale);

    const req = createIntakeRequest({
      wallet: TEST_WALLET,
      kind: "workshop_brief",
      title: "Workshop brief intake",
      brief: "private brief after crashed breaker",
    });

    expect(listIntakeRequests(TEST_WALLET).map((r) => r.id)).toContain(req.id);
    expect(existsSync(breakerFile)).toBe(false);
    expect(existsSync(join(root, `${TEST_WALLET}.lock`))).toBe(false);
  });

  it("removes atomic temp files when a ledger rename fails", () => {
    mkdirSync(join(root, `${TEST_WALLET}.json`));

    expect(() => createIntakeRequest({
      wallet: TEST_WALLET,
      kind: "workshop_build",
      title: "Workshop build intake",
      brief: "private build brief",
    })).toThrow();

    expect(readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(existsSync(join(root, `${TEST_WALLET}.lock`))).toBe(false);
  });
});
