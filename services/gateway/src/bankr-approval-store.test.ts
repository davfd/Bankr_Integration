import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileBackedBankrApprovalStore } from "./bankr-approval-store";
import type { BaseMcpApprovedAssetExchange, BaseMcpApprovedContractOperation, BaseMcpApprovedValueMovement, BaseMcpSession } from "./mcp-base";

let dir: string | undefined;

const CONTRACT = "0xeeee000000000000000000000000000000000005";
const DATA = "0x1234deadbeef";
const SECRET = "test-signing-secret";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function approvalPayload(record: Record<string, unknown>): Record<string, unknown> {
  if (record.operation_kind === "value_movement") {
    return {
      operation_kind: "value_movement",
      approval_id: record.approval_id,
      passport_id: record.passport_id,
      chain_id: record.chain_id,
      recipient: String(record.recipient).toLowerCase(),
      token_address: String(record.token_address).toLowerCase(),
      amount: record.amount,
      is_native_token: record.is_native_token,
      human_approval_receipt: record.human_approval_receipt,
      expires_at: record.expires_at,
      nonce: record.nonce,
    };
  }
  if (record.operation_kind === "asset_exchange") {
    return {
      operation_kind: "asset_exchange",
      approval_id: record.approval_id,
      passport_id: record.passport_id,
      chain_id: record.chain_id,
      from_token: String(record.from_token).toLowerCase(),
      to_token: String(record.to_token).toLowerCase(),
      amount: record.amount,
      min_buy_amount: record.min_buy_amount,
      human_approval_receipt: record.human_approval_receipt,
      expires_at: record.expires_at,
      nonce: record.nonce,
    };
  }
  const tx = record.transaction as Record<string, unknown>;
  return {
    approval_id: record.approval_id,
    passport_id: record.passport_id,
    chain_id: record.chain_id,
    contract: String(record.contract).toLowerCase(),
    method: record.method,
    calldata_hash: record.calldata_hash,
    human_approval_receipt: record.human_approval_receipt,
    expires_at: record.expires_at,
    nonce: record.nonce,
    transaction: {
      chainId: tx.chainId,
      to: String(tx.to).toLowerCase(),
      data_hash: `sha256:${sha256Hex(String(tx.data))}`,
      value: tx.value ?? "0x0",
    },
  };
}

function approvalHash(record: Record<string, unknown>): string {
  return `sha256:${sha256Hex(stable(approvalPayload(record)))}`;
}

function signature(record: Record<string, unknown>, secret = SECRET): string {
  return `hmac-sha256:${createHmac("sha256", secret).update(approvalHash(record)).digest("hex")}`;
}

function approved(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    approval_id: "approval-1",
    status: "approved",
    passport_id: "7241",
    chain_id: 8453,
    contract: CONTRACT,
    method: "setAgentURI",
    calldata_hash: `sha256:${sha256Hex(DATA)}`,
    human_approval_receipt: "sha256:approved-submit",
    expires_at: "2099-01-01T00:00:00.000Z",
    nonce: "nonce-1",
    transaction: { chainId: 8453, to: CONTRACT, data: DATA, value: "0x0" },
    ...overrides,
  };
  base.approval_hash = approvalHash(base);
  base.signature = signature(base);
  return base;
}

function approvedMove(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    operation_kind: "value_movement",
    approval_id: "move-1",
    status: "approved",
    passport_id: "7241",
    chain_id: 8453,
    recipient: "0xcccc000000000000000000000000000000000003",
    token_address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    amount: "2",
    is_native_token: false,
    human_approval_receipt: "sha256:human-approved-transfer",
    expires_at: "2099-01-01T00:00:00.000Z",
    nonce: "move-nonce-1",
    ...overrides,
  };
  base.approval_hash = approvalHash(base);
  base.signature = signature(base);
  return base;
}

function approvedSwap(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    operation_kind: "asset_exchange",
    approval_id: "swap-1",
    status: "approved",
    passport_id: "7241",
    chain_id: 8453,
    from_token: "0x4200000000000000000000000000000000000006",
    to_token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    amount: "0.5",
    min_buy_amount: "1000",
    human_approval_receipt: "sha256:human-approved-exchange",
    expires_at: "2099-01-01T00:00:00.000Z",
    nonce: "swap-nonce-1",
    ...overrides,
  };
  base.approval_hash = approvalHash(base);
  base.signature = signature(base);
  return base;
}

const session: BaseMcpSession = {
  wallet: "0xaaaa000000000000000000000000000000000001",
  passport: {
    agent_id: "leonardo-agent-7241",
    passport_id: "7241",
    active_system_prompt_hash: "sha256:test",
    authority_scope: ["answer", "base.contract.execute"],
  },
};

const receipt = { stage: "tool" as const, hash: "sha256:receipt", agent_id: "leonardo-agent-7241", passport_id: "7241", verdict: "allow" as const, reason: "allowed" };

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("Bankr approval store", () => {
  it("loads only signed sealed approval records whose canonical hash binds the submitted transaction body", async () => {
    dir = mkdtempSync(join(tmpdir(), "bankr-approval-store-"));
    const file = join(dir, "approvals.json");
    const valid = approved();
    const missingHash = approved({ approval_id: "missing-hash", nonce: "nonce-2" });
    delete missingHash.approval_hash;
    const wrongHash = { ...approved({ approval_id: "wrong-hash", nonce: "nonce-3" }), approval_hash: "sha256:not-the-canonical-hash" };
    const tamperedTx = approved({ approval_id: "tampered-tx", nonce: "nonce-4" });
    (tamperedTx.transaction as Record<string, unknown>).data = "0xdeadbeef";
    const badSignature = { ...approved({ approval_id: "bad-signature", nonce: "nonce-5" }), signature: "hmac-sha256:bad" };
    writeFileSync(file, JSON.stringify({ approvals: [valid, missingHash, wrongHash, tamperedTx, badSignature] }), "utf8");

    const store = createFileBackedBankrApprovalStore(file, { signingSecret: SECRET });

    await expect(store.getApprovedContractOperation({ approval_id: "approval-1", passport_id: "7241", chain_id: 8453 })).resolves.toMatchObject({
      approval_id: "approval-1",
      approval_hash: valid.approval_hash,
      signature_scheme: "hmac-sha256",
      transaction: { data: DATA },
    });
    for (const approval_id of ["missing-hash", "wrong-hash", "tampered-tx", "bad-signature"]) {
      await expect(store.getApprovedContractOperation({ approval_id, passport_id: "7241", chain_id: 8453 })).resolves.toBeNull();
    }
  });

  it("accepts unsigned local v1 records only when no signing secret is configured", async () => {
    dir = mkdtempSync(join(tmpdir(), "bankr-approval-store-"));
    const file = join(dir, "approvals.json");
    const unsigned = approved();
    delete unsigned.signature;
    writeFileSync(file, JSON.stringify({ approvals: [unsigned] }), "utf8");

    const unsignedStore = createFileBackedBankrApprovalStore(file);
    await expect(unsignedStore.getApprovedContractOperation({ approval_id: "approval-1", passport_id: "7241", chain_id: 8453 })).resolves.toMatchObject({
      approval_id: "approval-1",
      signature_scheme: "unsigned_local_v1",
    });

    const signedStore = createFileBackedBankrApprovalStore(file, { signingSecret: SECRET });
    await expect(signedStore.getApprovedContractOperation({ approval_id: "approval-1", passport_id: "7241", chain_id: 8453 })).resolves.toBeNull();
  });

  it("loads signed sealed value movement and asset exchange records for the approval lifecycle", async () => {
    dir = mkdtempSync(join(tmpdir(), "bankr-approval-store-"));
    const file = join(dir, "approvals.json");
    const move = approvedMove();
    const swap = approvedSwap();
    const wrongKind = approvedMove({ approval_id: "wrong-kind", operation_kind: "asset_exchange", nonce: "wrong-kind-nonce" });
    wrongKind.approval_hash = approvalHash(wrongKind);
    wrongKind.signature = signature(wrongKind);
    const badSignature = { ...approvedSwap({ approval_id: "bad-sig", nonce: "bad-sig-nonce" }), signature: "hmac-sha256:bad" };
    writeFileSync(file, JSON.stringify({ approvals: [move, swap, wrongKind, badSignature] }), "utf8");

    const store = createFileBackedBankrApprovalStore(file, { signingSecret: SECRET });

    await expect(store.getApprovedValueMovement!({ approval_id: "move-1", passport_id: "7241", chain_id: 8453 })).resolves.toMatchObject({
      operation_kind: "value_movement",
      approval_id: "move-1",
      recipient: "0xcccc000000000000000000000000000000000003",
      approval_hash: move.approval_hash,
      signature_scheme: "hmac-sha256",
    });
    await expect(store.getApprovedAssetExchange!({ approval_id: "swap-1", passport_id: "7241", chain_id: 8453 })).resolves.toMatchObject({
      operation_kind: "asset_exchange",
      approval_id: "swap-1",
      from_token: "0x4200000000000000000000000000000000000006",
      approval_hash: swap.approval_hash,
      signature_scheme: "hmac-sha256",
    });
    await expect(store.getApprovedValueMovement!({ approval_id: "swap-1", passport_id: "7241", chain_id: 8453 })).resolves.toBeNull();
    await expect(store.getApprovedAssetExchange!({ approval_id: "move-1", passport_id: "7241", chain_id: 8453 })).resolves.toBeNull();
    await expect(store.getApprovedValueMovement!({ approval_id: "wrong-kind", passport_id: "7241", chain_id: 8453 })).resolves.toBeNull();
    await expect(store.getApprovedAssetExchange!({ approval_id: "bad-sig", passport_id: "7241", chain_id: 8453 })).resolves.toBeNull();
  });

  it("reserves, releases, consumes, and rejects replay with redacted append-only audit logs", async () => {
    dir = mkdtempSync(join(tmpdir(), "bankr-approval-store-"));
    const file = join(dir, "approvals.json");
    const usageDir = join(dir, "usage");
    const auditLog = join(dir, "audit.jsonl");
    const record = approved();
    writeFileSync(file, JSON.stringify({ approvals: [record] }), "utf8");
    const store = createFileBackedBankrApprovalStore(file, { signingSecret: SECRET, usageStorePath: usageDir, auditLogPath: auditLog });
    const approval = await store.getApprovedContractOperation({ approval_id: "approval-1", passport_id: "7241", chain_id: 8453 }) as BaseMcpApprovedContractOperation;

    const first = await store.reserveApprovedContractOperation!({ approval, session, receipt });
    expect(first).toMatchObject({ ok: true, reservation: { approval_id: "approval-1", nonce: "nonce-1", approval_hash: record.approval_hash } });
    await expect(store.reserveApprovedContractOperation!({ approval, session, receipt })).resolves.toMatchObject({ ok: false, reason: expect.stringMatching(/reserved|consumed|replay/i) });

    if (!first.ok) throw new Error("expected reservation");
    await store.releaseApprovedContractOperation!(first.reservation, { reason: "runtime failed" });
    const second = await store.reserveApprovedContractOperation!({ approval, session, receipt });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("expected second reservation");
    await store.consumeApprovedContractOperation!(second.reservation, { result: { executed: true, tx_hash: "0xabc" } });
    const consumedFiles = readdirSync(join(usageDir, "consumed"));
    expect(consumedFiles).toHaveLength(1);
    const consumedLedger = readFileSync(join(usageDir, "consumed", consumedFiles[0]!), "utf8");
    expect(consumedLedger).toContain("0xabc");
    expect(consumedLedger).not.toContain(DATA);
    await expect(store.reserveApprovedContractOperation!({ approval, session, receipt })).resolves.toMatchObject({ ok: false, reason: expect.stringMatching(/consumed|replay/i) });

    const audit = readFileSync(auditLog, "utf8");
    expect(audit).toContain("approval_reserved");
    expect(audit).toContain("approval_released");
    expect(audit).toContain("approval_consumed");
    expect(audit).not.toContain(SECRET);
    expect(audit).not.toContain(DATA);
    expect(audit).not.toContain("X-API-Key");
    expect(audit).not.toContain("Authorization");
    expect(audit).not.toContain("private_key");
  });

  it("blocks concurrent reservations so only one claimant can reach runtime", async () => {
    dir = mkdtempSync(join(tmpdir(), "bankr-approval-store-"));
    const file = join(dir, "approvals.json");
    const usageDir = join(dir, "usage");
    writeFileSync(file, JSON.stringify({ approvals: [approved()] }), "utf8");
    const store = createFileBackedBankrApprovalStore(file, { signingSecret: SECRET, usageStorePath: usageDir });
    const approval = await store.getApprovedContractOperation({ approval_id: "approval-1", passport_id: "7241", chain_id: 8453 }) as BaseMcpApprovedContractOperation;

    const reserve = store.reserveApprovedContractOperation!;
    const results: Array<{ ok: boolean; reason?: string }> = await Promise.all([
      reserve({ approval, session, receipt }),
      reserve({ approval, session, receipt }),
    ]);

    expect(results.filter((item: { ok: boolean }) => item.ok)).toHaveLength(1);
    expect(results.filter((item: { ok: boolean }) => !item.ok)).toHaveLength(1);
    expect(existsSync(usageDir)).toBe(true);
  });
});
