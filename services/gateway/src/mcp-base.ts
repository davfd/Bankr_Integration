import { createHash } from "node:crypto";
import { BANKR_READ_ONLY_GRANT_POLICY_SHA256 } from "./identity-kernel-passport-grant-update";
import {
  evaluateToolCall,
  type IdentityEnvelope,
  type IdentityVerdict,
  type Receipt,
} from "@leonardo/identity-kernel";
import type { JsonRpcId } from "./mcp-graph";

export const BASE_MCP_SCOPE = "base_mcp:governed" as const;

export type BaseMcpCapability =
  | "base.wallet.read"
  | "base.x402.pay"
  | "base.receipt.publish"
  | "base.contract.request_human"
  | "base.value.move"
  | "base.asset.exchange"
  | "base.contract.execute";

export type BaseMcpRisk = "read_only" | "spending" | "low_risk_write" | "human_gated_contract" | "human_approved_spend";

export type CapabilityGrant = {
  capability: BaseMcpCapability | string;
  chain_id?: number;
  allowed_recipients?: string[];
  allowed_assets?: string[];
  allowed_contracts?: string[];
  allowed_methods?: string[];
  max_per_call?: string | number;
  max_per_day?: string | number;
  requires_human?: boolean;
  expires_at?: string;
  policy_hash?: string;
};

export type BaseMcpPassport = {
  agent_id: string;
  passport_id: string;
  /** ERC-8004 reserved on-chain agentWallet when verified and non-zero. */
  agent_wallet?: string;
  active_system_prompt_hash: string;
  authority_scope: string[];
  risk_context?: string;
  capability_grants?: CapabilityGrant[];
};

export type BaseMcpSession = {
  wallet: string;
  passport: BaseMcpPassport;
};

type BaseMcpApprovedOperationCommon = {
  approval_id: string;
  status: "approved";
  passport_id: string;
  chain_id: number;
  human_approval_receipt: string;
  approval_hash: string;
  nonce: string;
  signature?: string;
  signature_scheme?: "hmac-sha256" | "unsigned_local_v1";
  expires_at?: string;
};

export type BaseMcpApprovedContractOperation = BaseMcpApprovedOperationCommon & {
  operation_kind?: "contract_operation";
  contract: string;
  method: string;
  calldata_hash: string;
  purpose?: string;
  value?: string | number;
  transaction: {
    chainId: number;
    to: string;
    data: string;
    value?: string;
  };
};

export type BaseMcpApprovedValueMovement = BaseMcpApprovedOperationCommon & {
  operation_kind?: "value_movement";
  recipient: string;
  token_address: string;
  amount: string;
  is_native_token: boolean;
};

export type BaseMcpApprovedAssetExchange = BaseMcpApprovedOperationCommon & {
  operation_kind?: "asset_exchange";
  from_token: string;
  to_token: string;
  amount: string;
  min_buy_amount: string;
};

export type BaseMcpApprovedGovernedOperation = BaseMcpApprovedContractOperation | BaseMcpApprovedValueMovement | BaseMcpApprovedAssetExchange;

export type BaseMcpApprovalReservation = {
  approval_id: string;
  passport_id: string;
  chain_id: number;
  approval_hash: string;
  nonce: string;
  reservation_id?: string;
};

export type BaseMcpApprovalReservationInput = {
  approval: BaseMcpApprovedGovernedOperation;
  session: BaseMcpSession;
  receipt: Receipt;
};

export type BaseMcpApprovalReleaseInput = {
  reason: string;
  result?: unknown;
};

export type BaseMcpApprovalConsumeInput = {
  result?: unknown;
};

export type BaseMcpApprovalLookup = {
  approval_id: string;
  passport_id: string;
  chain_id: number;
};

export type BaseMcpApprovalStore = {
  getApprovedContractOperation: (input: BaseMcpApprovalLookup) => Promise<BaseMcpApprovedContractOperation | null> | BaseMcpApprovedContractOperation | null;
  getApprovedValueMovement?: (input: BaseMcpApprovalLookup) => Promise<BaseMcpApprovedValueMovement | null> | BaseMcpApprovedValueMovement | null;
  getApprovedAssetExchange?: (input: BaseMcpApprovalLookup) => Promise<BaseMcpApprovedAssetExchange | null> | BaseMcpApprovedAssetExchange | null;
  reserveApprovedContractOperation?: (input: BaseMcpApprovalReservationInput) => Promise<{ ok: true; reservation: BaseMcpApprovalReservation } | { ok: false; reason: string }> | { ok: true; reservation: BaseMcpApprovalReservation } | { ok: false; reason: string };
  releaseApprovedContractOperation?: (reservation: BaseMcpApprovalReservation, input: BaseMcpApprovalReleaseInput) => Promise<void> | void;
  consumeApprovedContractOperation?: (reservation: BaseMcpApprovalReservation, input: BaseMcpApprovalConsumeInput) => Promise<void> | void;
};

export type BaseMcpRuntime = {
  readWalletState?: (input: BaseMcpExecutionInput) => Promise<unknown> | unknown;
  payX402Invoice?: (input: BaseMcpExecutionInput) => Promise<unknown> | unknown;
  publishReceiptHash?: (input: BaseMcpExecutionInput) => Promise<unknown> | unknown;
  requestHumanApprovedContractCall?: (input: BaseMcpExecutionInput) => Promise<unknown> | unknown;
  executeApprovedValueMovement?: (input: BaseMcpExecutionInput) => Promise<unknown> | unknown;
  executeApprovedAssetExchange?: (input: BaseMcpExecutionInput) => Promise<unknown> | unknown;
  executeApprovedContractOperation?: (input: BaseMcpExecutionInput) => Promise<unknown> | unknown;
};

export type BaseMcpExecutionInput = {
  tool: string;
  manifest: BaseMcpToolManifest;
  args: Record<string, unknown>;
  session: BaseMcpSession;
  grant: CapabilityGrant;
  receipt: Receipt;
  approvedOperation?: BaseMcpApprovedGovernedOperation;
  approvedContractOperation?: BaseMcpApprovedContractOperation;
};

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

export type BaseMcpToolManifest = {
  name: string;
  capability: BaseMcpCapability;
  risk: BaseMcpRisk;
  description: string;
  inputSchema: Record<string, unknown>;
};

const ADDRESS_SCHEMA = { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" };
const PASSPORT_FIELD = { type: "string", description: "ERC-8004 Agent Passport token id bound to the wallet-session owner." };
const CHAIN_FIELD = { type: "number", description: "EVM chain id. Base mainnet = 8453; Base Sepolia = 84532." };

export const BASE_MCP_TOOLS: BaseMcpToolManifest[] = [
  {
    name: "read_wallet_state",
    capability: "base.wallet.read",
    risk: "read_only",
    description: "Read bounded wallet state for the passport-governed agent wallet. No transfers, approvals, swaps, or contract writes.",
    inputSchema: {
      type: "object",
      properties: { passport_id: PASSPORT_FIELD, agent_wallet: ADDRESS_SCHEMA, chain_id: CHAIN_FIELD },
      required: ["passport_id", "chain_id"],
      additionalProperties: false,
    },
  },
  {
    name: "pay_x402_invoice",
    capability: "base.x402.pay",
    risk: "spending",
    description: "Pay a declared x402 invoice only when passport capability grants allow recipient, chain, and amount. No raw token transfer exposure.",
    inputSchema: {
      type: "object",
      properties: {
        passport_id: PASSPORT_FIELD,
        recipient: ADDRESS_SCHEMA,
        amount: { type: "string", description: "Decimal human amount. Enforced against grant max_per_call." },
        asset: { type: "string", description: "Asset symbol/address from grant policy." },
        chain_id: CHAIN_FIELD,
        invoice_url: { type: "string" },
      },
      required: ["passport_id", "recipient", "amount", "chain_id", "invoice_url"],
      additionalProperties: false,
    },
  },
  {
    name: "publish_receipt_hash",
    capability: "base.receipt.publish",
    risk: "low_risk_write",
    description: "Publish or queue a receipt hash/attestation pointer under passport policy. Does not reveal raw private logs or secrets.",
    inputSchema: {
      type: "object",
      properties: {
        passport_id: PASSPORT_FIELD,
        chain_id: CHAIN_FIELD,
        receipt_hash: { type: "string", description: "sha256/ipfs/evidence hash only; no raw private content." },
        subject: { type: "string" },
      },
      required: ["passport_id", "chain_id", "receipt_hash"],
      additionalProperties: false,
    },
  },
  {
    name: "request_human_approved_contract_call",
    capability: "base.contract.request_human",
    risk: "human_gated_contract",
    description: "Create a human-approval envelope for a specific contract call. It never executes arbitrary calldata by itself.",
    inputSchema: {
      type: "object",
      properties: {
        passport_id: PASSPORT_FIELD,
        chain_id: CHAIN_FIELD,
        contract: ADDRESS_SCHEMA,
        method: { type: "string" },
        calldata_hash: { type: "string", description: "Hash of calldata, not raw unbounded calldata." },
        purpose: { type: "string" },
      },
      required: ["passport_id", "chain_id", "contract", "method", "calldata_hash", "purpose"],
      additionalProperties: false,
    },
  },
  {
    name: "execute_approved_value_movement",
    capability: "base.value.move",
    risk: "human_approved_spend",
    description: "Execute a Bankr-backed value movement only from a sealed server-side approval record plus Approval Authority usage lifecycle. This is not a raw transfer tool.",
    inputSchema: {
      type: "object",
      properties: {
        passport_id: PASSPORT_FIELD,
        chain_id: CHAIN_FIELD,
        approval_id: { type: "string", description: "Opaque server-side approval id for a previously human-approved value movement." },
        human_approval_receipt: { type: "string", description: "Receipt hash proving separate human approval for this exact movement." },
      },
      required: ["passport_id", "chain_id", "approval_id", "human_approval_receipt"],
      additionalProperties: false,
    },
  },
  {
    name: "execute_approved_asset_exchange",
    capability: "base.asset.exchange",
    risk: "human_approved_spend",
    description: "Execute a Bankr-backed asset exchange only from a sealed server-side approval record plus Approval Authority usage lifecycle. This is not a raw swap tool.",
    inputSchema: {
      type: "object",
      properties: {
        passport_id: PASSPORT_FIELD,
        chain_id: CHAIN_FIELD,
        approval_id: { type: "string", description: "Opaque server-side approval id for a previously human-approved asset exchange." },
        human_approval_receipt: { type: "string", description: "Receipt hash proving separate human approval for this exact exchange." },
      },
      required: ["passport_id", "chain_id", "approval_id", "human_approval_receipt"],
      additionalProperties: false,
    },
  },
  {
    name: "execute_approved_contract_operation",
    capability: "base.contract.execute",
    risk: "human_approved_spend",
    description: "Execute a sealed human-approved contract operation through Bankr only by approval_id. Raw transaction body/calldata is retrieved server-side from the approval store and is never accepted from model arguments.",
    inputSchema: {
      type: "object",
      properties: {
        passport_id: PASSPORT_FIELD,
        chain_id: CHAIN_FIELD,
        approval_id: { type: "string", description: "Opaque server-side approval id for a previously human-approved transaction body." },
        human_approval_receipt: { type: "string", description: "Receipt hash proving separate human approval for this exact operation." },
      },
      required: ["passport_id", "chain_id", "approval_id", "human_approval_receipt"],
      additionalProperties: false,
    },
  },
];

const MANIFESTS = new Map(BASE_MCP_TOOLS.map((tool) => [tool.name, tool]));

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function rpcResult(id: JsonRpcId | undefined, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: JsonRpcId | undefined, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function textResult(payload: unknown, isError = false): Record<string, unknown> {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], isError };
}

function callArgs(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object") return {};
  const args = (params as Record<string, unknown>).arguments;
  return args && typeof args === "object" ? (args as Record<string, unknown>) : {};
}

function cleanToolName(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

function lower(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizedAddress(value: unknown): string {
  const text = lower(value);
  return /^0x[0-9a-f]{40}$/.test(text) ? text : "";
}

function normalizeAgentWalletArgs(args: Record<string, unknown>, session: BaseMcpSession): { ok: true; args: Record<string, unknown> } | { ok: false; reason: string } {
  const hasAgentWalletArg = Object.hasOwn(args, "agent_wallet");
  const requested = normalizedAddress(args.agent_wallet);
  if (hasAgentWalletArg && !requested) {
    return { ok: false, reason: "agent_wallet must be a 0x-prefixed EVM address" };
  }
  const verifiedAgentWallet = normalizedAddress(session.passport.agent_wallet);
  const sessionWallet = normalizedAddress(session.wallet);

  if (verifiedAgentWallet) {
    if (requested && requested !== verifiedAgentWallet) {
      return { ok: false, reason: "agent_wallet does not match the verified ERC-8004 agentWallet" };
    }
    return { ok: true, args: { ...args, agent_wallet: verifiedAgentWallet } };
  }

  if (requested && requested !== sessionWallet) {
    return { ok: false, reason: "agent_wallet must match the signed session wallet unless ERC-8004 agentWallet is verified" };
  }
  return { ok: true, args: { ...args, agent_wallet: requested || sessionWallet } };
}

function amount(value: unknown): number | null {
  const n = Number(String(value ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function hasRawTransactionFields(args: Record<string, unknown>): boolean {
  return ["transaction", "tx", "to", "data", "calldata", "calldata_hash", "value", "signed_transaction"].some((key) => Object.hasOwn(args, key));
}

function hasRawValueMovementFields(args: Record<string, unknown>): boolean {
  return ["recipient", "token_address", "amount", "is_native_token", "transfer", "bankr_body", "body"].some((key) => Object.hasOwn(args, key));
}

function hasRawAssetExchangeFields(args: Record<string, unknown>): boolean {
  return ["from_token", "to_token", "amount", "min_buy_amount", "quote", "swap", "bankr_body", "body"].some((key) => Object.hasOwn(args, key));
}

function asPositiveString(value: unknown): string {
  return String(value ?? "").trim();
}

function validateApprovedOperationCommon(
  approval: BaseMcpApprovedGovernedOperation,
  args: Record<string, unknown>,
  session: BaseMcpSession,
  kind: string,
): { ok: true; approvalId: string; humanApproval: string; chainId: number } | { ok: false; reason: string } {
  const approvalId = asPositiveString(args.approval_id);
  const humanApproval = asPositiveString(args.human_approval_receipt);
  const chainId = Number(args.chain_id);
  if (!approvalId) return { ok: false, reason: `approval_id required for governed ${kind}` };
  if (!humanApproval) return { ok: false, reason: `human approval receipt required for governed ${kind}` };
  if (!Number.isFinite(chainId)) return { ok: false, reason: `chain_id required for governed ${kind}` };
  if (approval.status !== "approved") return { ok: false, reason: "approval record is not approved" };
  if (!asPositiveString(approval.approval_hash) || !asPositiveString(approval.nonce)) return { ok: false, reason: "approval record must include sealed approval_hash and nonce" };
  if (approval.approval_id !== approvalId) return { ok: false, reason: "approval_id does not match approval record" };
  if (approval.passport_id !== session.passport.passport_id) return { ok: false, reason: "approval passport_id does not match resolved passport" };
  if (approval.chain_id !== chainId) return { ok: false, reason: "approval chain_id does not match request" };
  if (lower(approval.human_approval_receipt) !== lower(humanApproval)) return { ok: false, reason: "human approval receipt does not match approval record" };
  if (approval.expires_at && Date.now() > Date.parse(approval.expires_at)) return { ok: false, reason: "approval record expired" };
  return { ok: true, approvalId, humanApproval, chainId };
}

function validateApprovedContractOperation(
  approval: BaseMcpApprovedContractOperation,
  args: Record<string, unknown>,
  session: BaseMcpSession,
): { ok: true; effectiveArgs: Record<string, unknown> } | { ok: false; reason: string } {
  const common = validateApprovedOperationCommon(approval, args, session, "contract operation");
  if (!common.ok) return common;
  if (approval.transaction.chainId !== common.chainId) return { ok: false, reason: "approval chain_id does not match request" };
  const contract = normalizedAddress(approval.contract);
  if (!contract) return { ok: false, reason: "approval contract must be a 0x-prefixed EVM address" };
  if (normalizedAddress(approval.transaction.to) !== contract) return { ok: false, reason: "approval transaction target must match approved contract" };
  const data = asPositiveString(approval.transaction.data);
  if (!/^0x[0-9a-fA-F]+$/.test(data)) return { ok: false, reason: "approval transaction data must be sealed hex calldata" };
  return {
    ok: true,
    effectiveArgs: {
      ...args,
      contract,
      method: asPositiveString(approval.method),
      calldata_hash: asPositiveString(approval.calldata_hash),
      value: approval.transaction.value ?? approval.value ?? "0",
    },
  };
}

function validateApprovedValueMovement(
  approval: BaseMcpApprovedValueMovement,
  args: Record<string, unknown>,
  session: BaseMcpSession,
): { ok: true; effectiveArgs: Record<string, unknown> } | { ok: false; reason: string } {
  const common = validateApprovedOperationCommon(approval, args, session, "value movement");
  if (!common.ok) return common;
  const recipient = normalizedAddress(approval.recipient);
  if (!recipient) return { ok: false, reason: "approval recipient must be a 0x-prefixed EVM address" };
  const token = normalizedAddress(approval.token_address);
  if (!token) return { ok: false, reason: "approval asset must be a 0x-prefixed EVM address" };
  const requested = amount(approval.amount);
  if (requested === null || requested <= 0) return { ok: false, reason: "approval amount must be positive" };
  if (typeof approval.is_native_token !== "boolean") return { ok: false, reason: "approval is_native_token must be boolean" };
  return {
    ok: true,
    effectiveArgs: {
      ...args,
      recipient,
      token_address: token,
      amount: approval.amount,
      is_native_token: approval.is_native_token,
    },
  };
}

function validateApprovedAssetExchange(
  approval: BaseMcpApprovedAssetExchange,
  args: Record<string, unknown>,
  session: BaseMcpSession,
): { ok: true; effectiveArgs: Record<string, unknown> } | { ok: false; reason: string } {
  const common = validateApprovedOperationCommon(approval, args, session, "asset exchange");
  if (!common.ok) return common;
  const fromToken = normalizedAddress(approval.from_token);
  const toToken = normalizedAddress(approval.to_token);
  if (!fromToken || !toToken) return { ok: false, reason: "approval assets must be 0x-prefixed EVM addresses" };
  const requested = amount(approval.amount);
  if (requested === null || requested <= 0) return { ok: false, reason: "approval amount must be positive" };
  const minBuy = amount(approval.min_buy_amount);
  if (minBuy === null || minBuy <= 0) return { ok: false, reason: "approval min_buy_amount must be positive" };
  return {
    ok: true,
    effectiveArgs: {
      ...args,
      from_token: fromToken,
      to_token: toToken,
      amount: approval.amount,
      min_buy_amount: approval.min_buy_amount,
    },
  };
}

async function resolveApprovedValueMovement(
  args: Record<string, unknown>,
  session: BaseMcpSession,
  approvalStore?: BaseMcpApprovalStore,
): Promise<{ ok: true; approval: BaseMcpApprovedValueMovement; effectiveArgs: Record<string, unknown> } | { ok: false; reason: string }> {
  if (hasRawValueMovementFields(args)) return { ok: false, reason: "raw value movement fields are not accepted from model arguments; use approval_id only" };
  const approval_id = asPositiveString(args.approval_id);
  const chain_id = Number(args.chain_id);
  if (!approval_id) return { ok: false, reason: "approval_id required for governed value movement" };
  if (!Number.isFinite(chain_id)) return { ok: false, reason: "chain_id required for governed value movement" };
  if (!approvalStore?.getApprovedValueMovement) return { ok: false, reason: "approval store unavailable for governed value movement" };
  const approval = await approvalStore.getApprovedValueMovement({ approval_id, passport_id: session.passport.passport_id, chain_id });
  if (!approval) return { ok: false, reason: "approved value movement not found" };
  const checked = validateApprovedValueMovement(approval, args, session);
  if (!checked.ok) return checked;
  return { ok: true, approval, effectiveArgs: checked.effectiveArgs };
}

async function resolveApprovedAssetExchange(
  args: Record<string, unknown>,
  session: BaseMcpSession,
  approvalStore?: BaseMcpApprovalStore,
): Promise<{ ok: true; approval: BaseMcpApprovedAssetExchange; effectiveArgs: Record<string, unknown> } | { ok: false; reason: string }> {
  if (hasRawAssetExchangeFields(args)) return { ok: false, reason: "raw asset exchange fields are not accepted from model arguments; use approval_id only" };
  const approval_id = asPositiveString(args.approval_id);
  const chain_id = Number(args.chain_id);
  if (!approval_id) return { ok: false, reason: "approval_id required for governed asset exchange" };
  if (!Number.isFinite(chain_id)) return { ok: false, reason: "chain_id required for governed asset exchange" };
  if (!approvalStore?.getApprovedAssetExchange) return { ok: false, reason: "approval store unavailable for governed asset exchange" };
  const approval = await approvalStore.getApprovedAssetExchange({ approval_id, passport_id: session.passport.passport_id, chain_id });
  if (!approval) return { ok: false, reason: "approved asset exchange not found" };
  const checked = validateApprovedAssetExchange(approval, args, session);
  if (!checked.ok) return checked;
  return { ok: true, approval, effectiveArgs: checked.effectiveArgs };
}

async function resolveApprovedContractOperation(
  args: Record<string, unknown>,
  session: BaseMcpSession,
  approvalStore?: BaseMcpApprovalStore,
): Promise<{ ok: true; approval: BaseMcpApprovedContractOperation; effectiveArgs: Record<string, unknown> } | { ok: false; reason: string }> {
  if (hasRawTransactionFields(args)) return { ok: false, reason: "raw transaction fields are not accepted from model arguments; use approval_id only" };
  const approval_id = asPositiveString(args.approval_id);
  const chain_id = Number(args.chain_id);
  if (!approval_id) return { ok: false, reason: "approval_id required for governed contract operation" };
  if (!Number.isFinite(chain_id)) return { ok: false, reason: "chain_id required for governed contract operation" };
  if (!approvalStore) return { ok: false, reason: "approval store unavailable for governed contract operation" };
  const approval = await approvalStore.getApprovedContractOperation({ approval_id, passport_id: session.passport.passport_id, chain_id });
  if (!approval) return { ok: false, reason: "approved contract operation not found" };
  const checked = validateApprovedContractOperation(approval, args, session);
  if (!checked.ok) return checked;
  return { ok: true, approval, effectiveArgs: checked.effectiveArgs };
}

function envelopeFor(session: BaseMcpSession, userRequest: string): IdentityEnvelope {
  const grantCapabilities = (session.passport.capability_grants ?? []).map((grant) => grant.capability).filter((cap): cap is string => typeof cap === "string");
  const authority = Array.from(new Set([...session.passport.authority_scope, ...grantCapabilities]));
  return {
    agent_id: session.passport.agent_id,
    passport_id: session.passport.passport_id,
    user_request: userRequest,
    active_system_prompt_hash: session.passport.active_system_prompt_hash,
    authority_scope: authority,
    requested_tools: [],
    risk_context: session.passport.risk_context ?? "tool_execution",
  };
}

function activeConstraints(envelope: IdentityEnvelope): string[] {
  return [
    `identity:${envelope.agent_id}`,
    `passport:${envelope.passport_id}`,
    `system:${envelope.active_system_prompt_hash}`,
    `risk:${envelope.risk_context}`,
    `authority:${[...envelope.authority_scope].sort().join(",")}`,
  ];
}

function customVerdict(envelope: IdentityEnvelope, verdict: IdentityVerdict["verdict"], reason: string, tool: string): IdentityVerdict {
  const base = {
    verdict,
    reason,
    safe_instruction: verdict === "allow" ? `Execute ${tool} only within passport policy.` : `Do not execute ${tool}; passport policy does not grant it.`,
    tool_grants: verdict === "allow" ? [tool] : [],
    tool_denials: verdict === "allow" ? [] : [tool],
    active_constraints: activeConstraints(envelope),
  };
  return { ...base, receipt_hash: sha256({ stage: "tool", envelope, verdict: base }) };
}

function receipt(envelope: IdentityEnvelope, verdict: IdentityVerdict): Receipt {
  return {
    stage: "tool",
    hash: verdict.receipt_hash,
    agent_id: envelope.agent_id,
    passport_id: envelope.passport_id,
    verdict: verdict.verdict,
    reason: verdict.reason,
  };
}

function isBlocking(verdict: IdentityVerdict): boolean {
  return verdict.verdict === "refuse" || verdict.verdict === "require_human" || verdict.verdict === "ask_clarifying";
}

function findGrant(manifest: BaseMcpToolManifest, args: Record<string, unknown>, grants: CapabilityGrant[]): { ok: true; grant: CapabilityGrant } | { ok: false; reason: string } {
  if ("capability_grant" in args || "capability_grants" in args) {
    return { ok: false, reason: "tool arguments cannot self-declare capability grants" };
  }
  const grant = grants.find((item) => item.capability === manifest.capability);
  if (!grant) return { ok: false, reason: `${manifest.capability} requires a passport capability grant` };
  if (grant.expires_at && Date.now() > Date.parse(grant.expires_at)) return { ok: false, reason: `${manifest.capability} capability grant expired` };
  const chainId = Number(args.chain_id);
  if (grant.chain_id !== undefined && grant.chain_id !== chainId) return { ok: false, reason: `${manifest.capability} chain_id outside capability grant` };
  if (manifest.name === "read_wallet_state") {
    const policyHash = String(grant.policy_hash ?? "").trim();
    if (!policyHash) return { ok: false, reason: "base.wallet.read requires policy_hash runtime witness" };
    if (policyHash !== BANKR_READ_ONLY_GRANT_POLICY_SHA256) return { ok: false, reason: "base.wallet.read policy_hash mismatch" };
  }

  if (manifest.name === "pay_x402_invoice") {
    const allowed = (grant.allowed_recipients ?? []).map(lower);
    const recipient = lower(args.recipient);
    if (allowed.length > 0 && !allowed.includes(recipient)) return { ok: false, reason: "recipient outside capability grant" };
    const requested = amount(args.amount);
    const max = grant.max_per_call === undefined ? null : amount(grant.max_per_call);
    if (requested === null || requested <= 0) return { ok: false, reason: "amount must be positive" };
    if (max !== null && requested > max) return { ok: false, reason: "amount exceeds max_per_call capability grant" };
  }

  if (manifest.name === "execute_approved_value_movement") {
    const humanApproval = String(args.human_approval_receipt ?? "").trim();
    if (!humanApproval) return { ok: false, reason: "human approval receipt required for governed value movement" };
    const allowedRecipients = (grant.allowed_recipients ?? []).map(lower);
    const recipient = lower(args.recipient);
    if (allowedRecipients.length > 0 && !allowedRecipients.includes(recipient)) return { ok: false, reason: "recipient outside capability grant" };
    const allowedAssets = (grant.allowed_assets ?? []).map(lower);
    const token = lower(args.token_address);
    if (allowedAssets.length > 0 && !allowedAssets.includes(token)) return { ok: false, reason: "asset outside capability grant" };
    const requested = amount(args.amount);
    const max = grant.max_per_call === undefined ? null : amount(grant.max_per_call);
    if (requested === null || requested <= 0) return { ok: false, reason: "amount must be positive" };
    if (max !== null && requested > max) return { ok: false, reason: "amount exceeds max_per_call capability grant" };
    if (typeof args.is_native_token !== "boolean") return { ok: false, reason: "is_native_token must be boolean" };
  }

  if (manifest.name === "execute_approved_asset_exchange") {
    const humanApproval = String(args.human_approval_receipt ?? "").trim();
    if (!humanApproval) return { ok: false, reason: "human approval receipt required for governed asset exchange" };
    const allowedAssets = (grant.allowed_assets ?? []).map(lower);
    const fromToken = lower(args.from_token);
    const toToken = lower(args.to_token);
    if (allowedAssets.length > 0 && (!allowedAssets.includes(fromToken) || !allowedAssets.includes(toToken))) return { ok: false, reason: "asset outside capability grant" };
    const requested = amount(args.amount);
    const max = grant.max_per_call === undefined ? null : amount(grant.max_per_call);
    if (requested === null || requested <= 0) return { ok: false, reason: "amount must be positive" };
    if (max !== null && requested > max) return { ok: false, reason: "amount exceeds max_per_call capability grant" };
    const minBuy = amount(args.min_buy_amount);
    if (minBuy === null || minBuy <= 0) return { ok: false, reason: "min_buy_amount must be positive" };
  }

  if (manifest.name === "execute_approved_contract_operation") {
    const humanApproval = String(args.human_approval_receipt ?? "").trim();
    if (!humanApproval) return { ok: false, reason: "human approval receipt required for governed contract operation" };
    const allowedContracts = (grant.allowed_contracts ?? []).map(lower);
    const contract = lower(args.contract);
    if (allowedContracts.length > 0 && !allowedContracts.includes(contract)) return { ok: false, reason: "contract outside capability grant" };
    const allowedMethods = (grant.allowed_methods ?? []).map((method) => method.toLowerCase());
    const method = String(args.method ?? "").trim().toLowerCase();
    if (allowedMethods.length > 0 && !allowedMethods.includes(method)) return { ok: false, reason: "method outside capability grant" };
    const value = amount(args.value ?? "0");
    const max = grant.max_per_call === undefined ? null : amount(grant.max_per_call);
    if (value === null || value < 0) return { ok: false, reason: "value must be non-negative" };
    if (max !== null && value > max) return { ok: false, reason: "value exceeds max_per_call capability grant" };
  }

  if (manifest.name === "request_human_approved_contract_call") {
    const allowedContracts = (grant.allowed_contracts ?? []).map(lower);
    const contract = lower(args.contract);
    if (allowedContracts.length > 0 && !allowedContracts.includes(contract)) return { ok: false, reason: "contract outside capability grant" };
    const allowedMethods = (grant.allowed_methods ?? []).map((method) => method.toLowerCase());
    const method = String(args.method ?? "").trim().toLowerCase();
    if (allowedMethods.length > 0 && !allowedMethods.includes(method)) return { ok: false, reason: "method outside capability grant" };
  }

  return { ok: true, grant };
}

function defaultRuntimeResult(manifest: BaseMcpToolManifest, args: Record<string, unknown>, session: BaseMcpSession): unknown {
  if (manifest.name === "read_wallet_state") {
    return {
      mode: "policy_only",
      wallet: session.wallet.toLowerCase(),
      agent_wallet: lower(args.agent_wallet) || null,
      chain_id: Number(args.chain_id),
      note: "No downstream wallet reader configured; Identity Kernel policy check passed.",
    };
  }
  return {
    mode: "policy_only",
    executed: false,
    note: "Downstream Base execution is not configured in this beta route.",
  };
}

async function executeAllowedTool(manifest: BaseMcpToolManifest, args: Record<string, unknown>, input: { session: BaseMcpSession; runtime?: BaseMcpRuntime; grant: CapabilityGrant; receipt: Receipt; approvedOperation?: BaseMcpApprovedGovernedOperation }): Promise<unknown> {
  const execInput: BaseMcpExecutionInput = {
    tool: manifest.name,
    manifest,
    args,
    session: input.session,
    grant: input.grant,
    receipt: input.receipt,
    approvedOperation: input.approvedOperation,
    approvedContractOperation: input.approvedOperation && "transaction" in input.approvedOperation ? input.approvedOperation : undefined,
  };
  if (manifest.name === "read_wallet_state") return input.runtime?.readWalletState ? input.runtime.readWalletState(execInput) : defaultRuntimeResult(manifest, args, input.session);
  if (manifest.name === "pay_x402_invoice") return input.runtime?.payX402Invoice ? input.runtime.payX402Invoice(execInput) : defaultRuntimeResult(manifest, args, input.session);
  if (manifest.name === "publish_receipt_hash") return input.runtime?.publishReceiptHash ? input.runtime.publishReceiptHash(execInput) : defaultRuntimeResult(manifest, args, input.session);
  if (manifest.name === "execute_approved_value_movement") return input.runtime?.executeApprovedValueMovement ? input.runtime.executeApprovedValueMovement(execInput) : defaultRuntimeResult(manifest, args, input.session);
  if (manifest.name === "execute_approved_asset_exchange") return input.runtime?.executeApprovedAssetExchange ? input.runtime.executeApprovedAssetExchange(execInput) : defaultRuntimeResult(manifest, args, input.session);
  if (manifest.name === "execute_approved_contract_operation") return input.runtime?.executeApprovedContractOperation ? input.runtime.executeApprovedContractOperation(execInput) : defaultRuntimeResult(manifest, args, input.session);
  return defaultRuntimeResult(manifest, args, input.session);
}

function runtimeAccepted(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const record = result as Record<string, unknown>;
  if (record.executed === false || record.accepted === false || record.ok === false) return false;
  return record.executed === true || record.accepted === true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error ?? "unknown runtime error");
}

export async function callBaseMcpTool(name: string, args: Record<string, unknown>, deps: { session?: BaseMcpSession; runtime?: BaseMcpRuntime; approvalStore?: BaseMcpApprovalStore }): Promise<Record<string, unknown>> {
  const session = deps.session;
  const manifest = MANIFESTS.get(name);
  if (!session) {
    return textResult({ ok: false, decision: "refuse", reason: "passport session unavailable" }, true);
  }
  const envelope = envelopeFor(session, `Base MCP tool request: ${name}`);

  if (!manifest) {
    const verdict = customVerdict(envelope, "refuse", `unknown or raw Base MCP tool is not exposed: ${name}`, name || "unknown_tool");
    return textResult({ ok: false, decision: "refuse", tool: name, reason: verdict.reason, receipt: receipt(envelope, verdict) }, true);
  }

  const passportId = typeof args.passport_id === "string" ? args.passport_id.trim() : "";
  if (!passportId || passportId !== session.passport.passport_id) {
    const verdict = customVerdict(envelope, "refuse", "passport_id missing or does not match the resolved wallet/passport session", manifest.capability);
    return textResult({ ok: false, decision: "refuse", tool: name, reason: verdict.reason, receipt: receipt(envelope, verdict) }, true);
  }

  let effectiveArgs = args;
  let approvedOperation: BaseMcpApprovedGovernedOperation | undefined;
  if (manifest.name === "read_wallet_state") {
    const walletArgs = normalizeAgentWalletArgs(args, session);
    if (!walletArgs.ok) {
      const verdict = customVerdict(envelope, "refuse", walletArgs.reason, manifest.capability);
      return textResult({ ok: false, decision: "refuse", tool: name, reason: verdict.reason, receipt: receipt(envelope, verdict), manifest: { capability: manifest.capability, risk: manifest.risk } }, true);
    }
    effectiveArgs = walletArgs.args;
  }

  if (manifest.name === "execute_approved_value_movement") {
    const resolved = await resolveApprovedValueMovement(args, session, deps.approvalStore);
    if (!resolved.ok) {
      const verdict = customVerdict(envelope, "refuse", resolved.reason, manifest.capability);
      return textResult({ ok: false, decision: "refuse", tool: name, reason: verdict.reason, receipt: receipt(envelope, verdict), manifest: { capability: manifest.capability, risk: manifest.risk } }, true);
    }
    effectiveArgs = resolved.effectiveArgs;
    approvedOperation = resolved.approval;
  }

  if (manifest.name === "execute_approved_asset_exchange") {
    const resolved = await resolveApprovedAssetExchange(args, session, deps.approvalStore);
    if (!resolved.ok) {
      const verdict = customVerdict(envelope, "refuse", resolved.reason, manifest.capability);
      return textResult({ ok: false, decision: "refuse", tool: name, reason: verdict.reason, receipt: receipt(envelope, verdict), manifest: { capability: manifest.capability, risk: manifest.risk } }, true);
    }
    effectiveArgs = resolved.effectiveArgs;
    approvedOperation = resolved.approval;
  }

  if (manifest.name === "execute_approved_contract_operation") {
    const resolved = await resolveApprovedContractOperation(args, session, deps.approvalStore);
    if (!resolved.ok) {
      const verdict = customVerdict(envelope, "refuse", resolved.reason, manifest.capability);
      return textResult({ ok: false, decision: "refuse", tool: name, reason: verdict.reason, receipt: receipt(envelope, verdict), manifest: { capability: manifest.capability, risk: manifest.risk } }, true);
    }
    effectiveArgs = resolved.effectiveArgs;
    approvedOperation = resolved.approval;
  }

  const kernelVerdict = evaluateToolCall(envelope, { name: manifest.capability, args: effectiveArgs });
  if (isBlocking(kernelVerdict)) {
    return textResult({ ok: false, decision: kernelVerdict.verdict, tool: name, reason: kernelVerdict.reason, receipt: receipt(envelope, kernelVerdict) }, true);
  }

  const grantCheck = findGrant(manifest, effectiveArgs, session.passport.capability_grants ?? []);
  if (!grantCheck.ok) {
    const verdict = customVerdict(envelope, "refuse", grantCheck.reason, manifest.capability);
    return textResult({ ok: false, decision: "refuse", tool: name, reason: verdict.reason, receipt: receipt(envelope, verdict), manifest: { capability: manifest.capability, risk: manifest.risk } }, true);
  }

  const allowVerdict = customVerdict(envelope, "allow", `${manifest.capability} is allowed by passport capability grant`, manifest.capability);
  const toolReceipt = receipt(envelope, allowVerdict);

  if (manifest.name === "request_human_approved_contract_call") {
    return textResult({
      ok: true,
      decision: "human_required",
      tool: name,
      executed: false,
      approval: {
        status: "pending_human_approval",
        passport_id: session.passport.passport_id,
        agent_id: session.passport.agent_id,
        chain_id: Number(effectiveArgs.chain_id),
        contract: lower(effectiveArgs.contract),
        method: String(effectiveArgs.method ?? ""),
        calldata_hash: String(effectiveArgs.calldata_hash ?? ""),
        purpose: String(effectiveArgs.purpose ?? ""),
      },
      receipt: toolReceipt,
      manifest: { capability: manifest.capability, risk: manifest.risk },
    });
  }

  let reservation: BaseMcpApprovalReservation | undefined;
  const approvedForLifecycle = approvedOperation && ["execute_approved_value_movement", "execute_approved_asset_exchange", "execute_approved_contract_operation"].includes(manifest.name) ? approvedOperation : undefined;
  if (approvedForLifecycle) {
    if (!deps.approvalStore?.reserveApprovedContractOperation || !deps.approvalStore.releaseApprovedContractOperation || !deps.approvalStore.consumeApprovedContractOperation) {
      const reason = `approval usage store unavailable for governed ${manifest.capability}`;
      const verdict = customVerdict(envelope, "refuse", reason, manifest.capability);
      return textResult({ ok: false, decision: "refuse", tool: name, reason: verdict.reason, receipt: receipt(envelope, verdict), manifest: { capability: manifest.capability, risk: manifest.risk } }, true);
    }
    const reserved = await deps.approvalStore.reserveApprovedContractOperation({ approval: approvedForLifecycle, session, receipt: toolReceipt });
    if (!reserved.ok) {
      const verdict = customVerdict(envelope, "refuse", reserved.reason, manifest.capability);
      return textResult({ ok: false, decision: "refuse", tool: name, reason: verdict.reason, receipt: receipt(envelope, verdict), manifest: { capability: manifest.capability, risk: manifest.risk } }, true);
    }
    reservation = reserved.reservation;
  }

  try {
    const result = await executeAllowedTool(manifest, effectiveArgs, { session, runtime: deps.runtime, grant: grantCheck.grant, receipt: toolReceipt, approvedOperation });
    if (approvedForLifecycle && reservation) {
      if (!runtimeAccepted(result)) {
        const reason = `approved ${manifest.capability} runtime did not report accepted execution`;
        await deps.approvalStore?.releaseApprovedContractOperation?.(reservation, { reason, result });
        const verdict = customVerdict(envelope, "refuse", reason, manifest.capability);
        return textResult({ ok: false, decision: "refuse", tool: name, reason: verdict.reason, result, receipt: receipt(envelope, verdict), manifest: { capability: manifest.capability, risk: manifest.risk } }, true);
      }
      await deps.approvalStore?.consumeApprovedContractOperation?.(reservation, { result });
    }
    return textResult({ ok: true, decision: "allow", tool: name, result, receipt: toolReceipt, manifest: { capability: manifest.capability, risk: manifest.risk } });
  } catch (error) {
    const message = errorMessage(error);
    if (approvedForLifecycle && reservation) {
      await deps.approvalStore?.releaseApprovedContractOperation?.(reservation, { reason: message });
    }
    const verdict = customVerdict(envelope, "refuse", `approved ${manifest.capability} runtime failed: ${message}`, manifest.capability);
    return textResult({ ok: false, decision: "refuse", tool: name, reason: verdict.reason, receipt: receipt(envelope, verdict), manifest: { capability: manifest.capability, risk: manifest.risk } }, true);
  }
}

export async function handleBaseMcpRequest(body: unknown, deps: { session?: BaseMcpSession; runtime?: BaseMcpRuntime; approvalStore?: BaseMcpApprovalStore } = {}): Promise<Record<string, unknown> | null> {
  if (!body || typeof body !== "object") return rpcError(null, -32600, "invalid JSON-RPC request");
  const req = body as JsonRpcRequest;
  const id = req.id;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return rpcError(id, -32600, "invalid JSON-RPC request");
  if (req.method === "notifications/initialized") return null;
  if (req.method === "initialize") {
    return rpcResult(id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "leonardo-base-identity-kernel", version: "0.1.0" },
      instructions:
        "Passport-Governed Base MCP Gateway. Tools are wrappers, not raw wallet powers. Every tool call must carry passport_id and pass Identity Kernel capability policy before any downstream Base action.",
    });
  }
  if (req.method === "tools/list") return rpcResult(id, { tools: BASE_MCP_TOOLS });
  if (req.method === "tools/call") {
    const p = req.params && typeof req.params === "object" ? (req.params as Record<string, unknown>) : {};
    const toolName = cleanToolName(p.name);
    if (!toolName) return rpcError(id, -32602, "invalid tool name");
    return rpcResult(id, await callBaseMcpTool(toolName, callArgs(req.params), deps));
  }
  return rpcError(id, -32601, "method not found");
}

export function baseMcpToolName(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const req = body as JsonRpcRequest;
  if (req.method !== "tools/call") return req.method;
  if (!req.params || typeof req.params !== "object") return "__invalid_tool_name__";
  const name = (req.params as Record<string, unknown>).name;
  return typeof name === "string" && name.trim() ? name.slice(0, 80) : "__invalid_tool_name__";
}
