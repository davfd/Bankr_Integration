import { createHash, createHmac } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  BaseMcpApprovalLookup,
  BaseMcpApprovalReservation,
  BaseMcpApprovalReservationInput,
  BaseMcpApprovalStore,
  BaseMcpApprovedAssetExchange,
  BaseMcpApprovedContractOperation,
  BaseMcpApprovedGovernedOperation,
  BaseMcpApprovedValueMovement,
} from "./mcp-base";

export type BankrApprovalStoreOptions = {
  signingSecret?: string;
  usageStorePath?: string;
  auditLogPath?: string;
  now?: () => Date;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isHexData(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}

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

function approvalPayload(item: Record<string, unknown>, tx?: Record<string, unknown>): Record<string, unknown> {
  if (item.operation_kind === "value_movement") {
    return {
      operation_kind: "value_movement",
      approval_id: item.approval_id,
      passport_id: item.passport_id,
      chain_id: item.chain_id,
      recipient: String(item.recipient ?? "").toLowerCase(),
      token_address: String(item.token_address ?? "").toLowerCase(),
      amount: item.amount,
      is_native_token: item.is_native_token,
      human_approval_receipt: item.human_approval_receipt,
      expires_at: item.expires_at,
      nonce: item.nonce,
    };
  }
  if (item.operation_kind === "asset_exchange") {
    return {
      operation_kind: "asset_exchange",
      approval_id: item.approval_id,
      passport_id: item.passport_id,
      chain_id: item.chain_id,
      from_token: String(item.from_token ?? "").toLowerCase(),
      to_token: String(item.to_token ?? "").toLowerCase(),
      amount: item.amount,
      min_buy_amount: item.min_buy_amount,
      human_approval_receipt: item.human_approval_receipt,
      expires_at: item.expires_at,
      nonce: item.nonce,
    };
  }
  const body = tx ?? {};
  return {
    approval_id: item.approval_id,
    passport_id: item.passport_id,
    chain_id: item.chain_id,
    contract: String(item.contract ?? "").toLowerCase(),
    method: item.method,
    calldata_hash: item.calldata_hash,
    human_approval_receipt: item.human_approval_receipt,
    expires_at: item.expires_at,
    nonce: item.nonce,
    transaction: {
      chainId: body.chainId,
      to: String(body.to ?? "").toLowerCase(),
      data_hash: `sha256:${sha256Hex(String(body.data ?? ""))}`,
      value: body.value ?? "0x0",
    },
  };
}

function canonicalApprovalHash(item: Record<string, unknown>, tx?: Record<string, unknown>): string {
  return `sha256:${sha256Hex(stable(approvalPayload(item, tx)))}`;
}

function hmacSignature(hash: string, secret: string): string {
  return `hmac-sha256:${createHmac("sha256", secret).update(hash).digest("hex")}`;
}

function signatureSchemeFor(item: Record<string, unknown>, computedHash: string, opts: BankrApprovalStoreOptions): "hmac-sha256" | "unsigned_local_v1" | null {
  const signingSecret = opts.signingSecret?.trim();
  if (signingSecret) {
    return typeof item.signature === "string" && item.signature === hmacSignature(computedHash, signingSecret) ? "hmac-sha256" : null;
  }
  return typeof item.signature === "string" && item.signature.startsWith("hmac-sha256:") ? "hmac-sha256" : "unsigned_local_v1";
}

function commonApprovalFields(item: Record<string, unknown>): boolean {
  return item.status === "approved" &&
    typeof item.approval_id === "string" && item.approval_id.trim().length > 0 &&
    typeof item.passport_id === "string" && item.passport_id.trim().length > 0 &&
    typeof item.chain_id === "number" && Number.isFinite(item.chain_id) &&
    typeof item.human_approval_receipt === "string" && item.human_approval_receipt.trim().length > 0 &&
    typeof item.approval_hash === "string" && item.approval_hash.trim().length > 0 &&
    typeof item.nonce === "string" && item.nonce.trim().length > 0 &&
    (item.expires_at === undefined || typeof item.expires_at === "string");
}

function parseApproval(value: unknown, opts: BankrApprovalStoreOptions): BaseMcpApprovedGovernedOperation | null {
  const item = asRecord(value);
  if (!item || !commonApprovalFields(item)) return null;
  const approval_id = item.approval_id as string;
  const passport_id = item.passport_id as string;
  const chain_id = item.chain_id as number;
  const human_approval_receipt = item.human_approval_receipt as string;
  const approval_hash = item.approval_hash as string;
  const nonce = item.nonce as string;

  if (item.operation_kind === "value_movement") {
    if (!isAddress(item.recipient) || !isAddress(item.token_address)) return null;
    if (typeof item.amount !== "string" || !item.amount.trim()) return null;
    if (typeof item.is_native_token !== "boolean") return null;
    const recipient = item.recipient.toLowerCase();
    const token_address = item.token_address.toLowerCase();
    const moveAmount = item.amount;
    const is_native_token = item.is_native_token;
    const computedHash = canonicalApprovalHash(item);
    if (item.approval_hash !== computedHash) return null;
    const signature_scheme = signatureSchemeFor(item, computedHash, opts);
    if (!signature_scheme) return null;
    const approval: BaseMcpApprovedValueMovement = {
      operation_kind: "value_movement",
      approval_id,
      status: "approved",
      passport_id,
      chain_id,
      recipient,
      token_address,
      amount: moveAmount,
      is_native_token,
      human_approval_receipt,
      approval_hash,
      nonce,
      signature: typeof item.signature === "string" ? item.signature : undefined,
      signature_scheme,
      expires_at: typeof item.expires_at === "string" ? item.expires_at : undefined,
    };
    return approval;
  }

  if (item.operation_kind === "asset_exchange") {
    if (!isAddress(item.from_token) || !isAddress(item.to_token)) return null;
    if (typeof item.amount !== "string" || !item.amount.trim()) return null;
    if (typeof item.min_buy_amount !== "string" || !item.min_buy_amount.trim()) return null;
    const from_token = item.from_token.toLowerCase();
    const to_token = item.to_token.toLowerCase();
    const swapAmount = item.amount;
    const min_buy_amount = item.min_buy_amount;
    const computedHash = canonicalApprovalHash(item);
    if (item.approval_hash !== computedHash) return null;
    const signature_scheme = signatureSchemeFor(item, computedHash, opts);
    if (!signature_scheme) return null;
    const approval: BaseMcpApprovedAssetExchange = {
      operation_kind: "asset_exchange",
      approval_id,
      status: "approved",
      passport_id,
      chain_id,
      from_token,
      to_token,
      amount: swapAmount,
      min_buy_amount,
      human_approval_receipt,
      approval_hash,
      nonce,
      signature: typeof item.signature === "string" ? item.signature : undefined,
      signature_scheme,
      expires_at: typeof item.expires_at === "string" ? item.expires_at : undefined,
    };
    return approval;
  }

  const tx = asRecord(item.transaction);
  if (!tx) return null;
  if (!isAddress(item.contract)) return null;
  if (typeof item.method !== "string" || !item.method.trim()) return null;
  if (typeof item.calldata_hash !== "string" || !item.calldata_hash.trim()) return null;
  if (typeof tx.chainId !== "number" || tx.chainId !== item.chain_id) return null;
  if (!isAddress(tx.to) || tx.to.toLowerCase() !== item.contract.toLowerCase()) return null;
  if (!isHexData(tx.data)) return null;
  if (tx.value !== undefined && typeof tx.value !== "string") return null;
  if (item.value !== undefined && typeof item.value !== "string" && typeof item.value !== "number") return null;
  const contract = item.contract;
  const method = item.method;
  const calldata_hash = item.calldata_hash;

  const computedHash = canonicalApprovalHash(item, tx);
  if (item.approval_hash !== computedHash) return null;
  const signature_scheme = signatureSchemeFor(item, computedHash, opts);
  if (!signature_scheme) return null;

  return {
    operation_kind: item.operation_kind === "contract_operation" ? "contract_operation" : undefined,
    approval_id,
    status: "approved",
    passport_id,
    chain_id,
    contract,
    method,
    calldata_hash,
    human_approval_receipt,
    approval_hash,
    nonce,
    signature: typeof item.signature === "string" ? item.signature : undefined,
    signature_scheme,
    purpose: typeof item.purpose === "string" ? item.purpose : undefined,
    value: typeof item.value === "string" || typeof item.value === "number" ? item.value : undefined,
    expires_at: typeof item.expires_at === "string" ? item.expires_at : undefined,
    transaction: {
      chainId: tx.chainId,
      to: tx.to,
      data: tx.data,
      value: typeof tx.value === "string" ? tx.value : undefined,
    },
  };
}

function parseApprovals(value: unknown, opts: BankrApprovalStoreOptions): BaseMcpApprovedGovernedOperation[] {
  const root = asRecord(value);
  const list = Array.isArray(value) ? value : Array.isArray(root?.approvals) ? root.approvals : [];
  return list.map((item) => parseApproval(item, opts)).filter((item): item is BaseMcpApprovedGovernedOperation => item !== null);
}

function reservationKey(approval: BaseMcpApprovedGovernedOperation | BaseMcpApprovalReservation): string {
  return sha256Hex(stable({
    approval_id: approval.approval_id,
    passport_id: approval.passport_id,
    chain_id: approval.chain_id,
    approval_hash: approval.approval_hash,
    nonce: approval.nonce,
  }));
}

function redactedResult(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  return {
    executed: record.executed,
    accepted: record.accepted,
    ok: record.ok,
    tx_hash: typeof record.tx_hash === "string" ? record.tx_hash : undefined,
  };
}

function auditEvent(opts: BankrApprovalStoreOptions, event: string, approval: Partial<BaseMcpApprovedGovernedOperation> & { reservation_id?: string }, extra: Record<string, unknown> = {}): void {
  const path = opts.auditLogPath?.trim();
  if (!path) return;
  const line = {
    ts: (opts.now?.() ?? new Date()).toISOString(),
    event,
    approval_id: approval.approval_id,
    passport_id: approval.passport_id,
    chain_id: approval.chain_id,
    approval_hash: approval.approval_hash,
    nonce: approval.nonce,
    reservation_id: approval.reservation_id,
    ...extra,
  };
  mkdirSync(join(path, ".."), { recursive: true });
  appendFileSync(path, `${JSON.stringify(line)}\n`, "utf8");
}

function usagePaths(root: string, approval: BaseMcpApprovedGovernedOperation | BaseMcpApprovalReservation): { reserved: string; consumed: string; reservation_id: string } {
  const reservation_id = reservationKey(approval);
  return {
    reserved: join(root, "reserved", `${reservation_id}.json`),
    consumed: join(root, "consumed", `${reservation_id}.json`),
    reservation_id,
  };
}

export function createFileBackedBankrApprovalStore(path: string, options: BankrApprovalStoreOptions = {}): BaseMcpApprovalStore {
  const filePath = path.trim();
  if (!filePath) throw new Error("approval store path required");
  const opts = { ...options };

  function readApprovals(): BaseMcpApprovedGovernedOperation[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      return [];
    }
    return parseApprovals(parsed, opts);
  }

  function isActive(approval: BaseMcpApprovedGovernedOperation): boolean {
    const now = opts.now?.() ?? new Date();
    return !approval.expires_at || now.getTime() <= Date.parse(approval.expires_at);
  }

  return {
    async getApprovedContractOperation(input: BaseMcpApprovalLookup): Promise<BaseMcpApprovedContractOperation | null> {
      const approvals = readApprovals();
      return approvals.find((approval): approval is BaseMcpApprovedContractOperation =>
        "transaction" in approval &&
        approval.approval_id === input.approval_id &&
        approval.passport_id === input.passport_id &&
        approval.chain_id === input.chain_id &&
        isActive(approval),
      ) ?? null;
    },

    async getApprovedValueMovement(input: BaseMcpApprovalLookup): Promise<BaseMcpApprovedValueMovement | null> {
      const approvals = readApprovals();
      return approvals.find((approval): approval is BaseMcpApprovedValueMovement =>
        approval.operation_kind === "value_movement" &&
        approval.approval_id === input.approval_id &&
        approval.passport_id === input.passport_id &&
        approval.chain_id === input.chain_id &&
        isActive(approval),
      ) ?? null;
    },

    async getApprovedAssetExchange(input: BaseMcpApprovalLookup): Promise<BaseMcpApprovedAssetExchange | null> {
      const approvals = readApprovals();
      return approvals.find((approval): approval is BaseMcpApprovedAssetExchange =>
        approval.operation_kind === "asset_exchange" &&
        approval.approval_id === input.approval_id &&
        approval.passport_id === input.passport_id &&
        approval.chain_id === input.chain_id &&
        isActive(approval),
      ) ?? null;
    },

    async reserveApprovedContractOperation(input: BaseMcpApprovalReservationInput): Promise<{ ok: true; reservation: BaseMcpApprovalReservation } | { ok: false; reason: string }> {
      const root = opts.usageStorePath?.trim();
      if (!root) return { ok: false, reason: "approval usage store unavailable for governed contract operation" };
      const paths = usagePaths(root, input.approval);
      mkdirSync(join(root, "reserved"), { recursive: true });
      mkdirSync(join(root, "consumed"), { recursive: true });
      if (existsSync(paths.consumed)) return { ok: false, reason: "approval already consumed; replay refused" };
      const reservation: BaseMcpApprovalReservation = {
        approval_id: input.approval.approval_id,
        passport_id: input.approval.passport_id,
        chain_id: input.approval.chain_id,
        approval_hash: input.approval.approval_hash,
        nonce: input.approval.nonce,
        reservation_id: paths.reservation_id,
      };
      try {
        writeFileSync(paths.reserved, JSON.stringify({ ...reservation, receipt_hash: input.receipt.hash, ts: (opts.now?.() ?? new Date()).toISOString() }), { encoding: "utf8", flag: "wx" });
      } catch {
        return { ok: false, reason: "approval already reserved or consumed; replay refused" };
      }
      try {
        auditEvent(opts, "approval_reserved", reservation, { receipt_hash: input.receipt.hash, signature_scheme: input.approval.signature_scheme });
      } catch {
        try { unlinkSync(paths.reserved); } catch { /* ignore cleanup */ }
        return { ok: false, reason: "approval audit append failed before runtime" };
      }
      return { ok: true, reservation };
    },

    async releaseApprovedContractOperation(reservation: BaseMcpApprovalReservation, input): Promise<void> {
      const root = opts.usageStorePath?.trim();
      if (root) {
        const paths = usagePaths(root, reservation);
        try { unlinkSync(paths.reserved); } catch { /* absent reservations are already released */ }
      }
      auditEvent(opts, "approval_released", reservation, { reason: input.reason, result: redactedResult(input.result) });
    },

    async consumeApprovedContractOperation(reservation: BaseMcpApprovalReservation, input): Promise<void> {
      const root = opts.usageStorePath?.trim();
      if (!root) throw new Error("approval usage store unavailable for governed contract operation");
      const paths = usagePaths(root, reservation);
      mkdirSync(join(root, "consumed"), { recursive: true });
      const consumedBody = JSON.stringify({ ...reservation, result: redactedResult(input.result), ts: (opts.now?.() ?? new Date()).toISOString() });
      try {
        renameSync(paths.reserved, paths.consumed);
        writeFileSync(paths.consumed, consumedBody, "utf8");
      } catch {
        writeFileSync(paths.consumed, consumedBody, { encoding: "utf8", flag: "wx" });
      }
      auditEvent(opts, "approval_consumed", reservation, { result: redactedResult(input.result) });
    },
  };
}

export function createBankrApprovalStoreFromEnv(env: Record<string, string | undefined> = process.env): BaseMcpApprovalStore | undefined {
  const path = env.BANKR_APPROVAL_STORE_PATH?.trim();
  return path ? createFileBackedBankrApprovalStore(path, {
    signingSecret: env.BANKR_APPROVAL_SIGNING_SECRET,
    usageStorePath: env.BANKR_APPROVAL_USAGE_STORE_PATH,
    auditLogPath: env.BANKR_APPROVAL_AUDIT_LOG_PATH,
  }) : undefined;
}
