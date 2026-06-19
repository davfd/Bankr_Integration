import { createHash } from "node:crypto";
import { encodeFunctionData, getAddress, isAddress, type Abi, type Address } from "viem";

export const BANKR_READ_ONLY_GRANT_POLICY_SHA256 = "c565cfdc9b659990d73cce9e50cb23c6d6c1ca6aee207c74f95b76ab26fe3473";

const READ_GRANT = {
  capability: "base.wallet.read",
  chain_id: 8453,
} as const;

const DANGEROUS_CAPABILITY_RE = /(?:value\.move|asset\.exchange|contract\.|x402|receipt\.publish|pay|swap|transfer|execute)/i;

const SET_AGENT_URI_ABI = [
  {
    type: "function",
    name: "setAgentURI",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "newURI", type: "string" },
    ],
    outputs: [],
  },
] as const satisfies Abi;

type JsonRecord = Record<string, unknown>;

export type RedactedGrantSemanticDiff = {
  preserved_keys: string[];
  changed_keys: string[];
  changed_non_grant_keys: string[];
  removed_keys: string[];
  added_grant: {
    capability: "base.wallet.read";
    chain_id: 8453;
    expires_at?: string;
    policy_hash: string;
  };
};

export type ReadOnlyGrantBuildInput = {
  passportId: string;
  currentDocument: JsonRecord;
  expiresAt?: string;
  policyHash?: string;
};

export type ReadOnlyGrantBuildResult =
  | {
      ok: true;
      document: JsonRecord;
      before_sha256: string;
      after_sha256: string;
      grant_count: number;
      semantic_diff: RedactedGrantSemanticDiff;
    }
  | {
      ok: false;
      reason: string;
      issues: string[];
      before_sha256: string;
    };

export type GrantUpdatePlanInput = ReadOnlyGrantBuildInput & {
  ownerAddress?: string | null;
  signerAddress?: string | null;
  registryAddress: string;
  chainId: number;
};

export type GrantUpdatePlanSummary = {
  status: "ready_to_sign" | "blocked_missing_signer" | "blocked_signer_not_owner" | "blocked_invalid_document" | "blocked_invalid_address";
  passport_id: string;
  chainId: number;
  registry_redacted: true;
  owner_redacted: true;
  signer_redacted: true;
  owner_matches_signer?: boolean;
  required_env?: string[];
  before_sha256?: string;
  after_sha256?: string;
  planned_document?: {
    grant_count: number;
    validation_ok: boolean;
    issues: string[];
    semantic_diff?: RedactedGrantSemanticDiff;
  };
  transaction?: {
    to: string;
    chainId: number;
    method: "setAgentURI";
    data: `0x${string}`;
    data_sha256: string;
    value: "0x0";
    args_summary: { passport_id: string; uri_redacted: true };
  };
};

export type GrantUpdateExecutionGuardInput = {
  planStatus: GrantUpdatePlanSummary["status"];
  executeRequested: boolean;
  acknowledgedMetadataMutation: boolean;
};

export type GrantUpdateExecutionGuardResult =
  | { ok: true; status: "execution_allowed" }
  | { ok: false; status: "blocked_plan_not_ready" | "blocked_execute_not_requested" | "blocked_missing_metadata_mutation_ack" };

export function grantUpdateExecutionGuard(input: GrantUpdateExecutionGuardInput): GrantUpdateExecutionGuardResult {
  if (input.planStatus !== "ready_to_sign") return { ok: false, status: "blocked_plan_not_ready" };
  if (!input.executeRequested) return { ok: false, status: "blocked_execute_not_requested" };
  if (!input.acknowledgedMetadataMutation) return { ok: false, status: "blocked_missing_metadata_mutation_ack" };
  return { ok: true, status: "execution_allowed" };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as JsonRecord)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stable(entryValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function cloneDocument(document: JsonRecord): JsonRecord {
  return JSON.parse(JSON.stringify(document)) as JsonRecord;
}

function grantArray(document: JsonRecord): JsonRecord[] {
  return Array.isArray(document.capability_grants) ? (document.capability_grants.filter((grant): grant is JsonRecord => Boolean(grant) && typeof grant === "object" && !Array.isArray(grant)) as JsonRecord[]) : [];
}

function semanticDiff(before: JsonRecord, after: JsonRecord, addedGrant: JsonRecord): RedactedGrantSemanticDiff {
  const beforeKeys = Object.keys(before).sort();
  const afterKeys = Object.keys(after).sort();
  const changedKeys = afterKeys.filter((key) => stable(before[key]) !== stable(after[key]));
  const removedKeys = beforeKeys.filter((key) => !(key in after));
  const preservedKeys = beforeKeys.filter((key) => key in after && stable(before[key]) === stable(after[key]));
  return {
    changed_keys: changedKeys,
    changed_non_grant_keys: changedKeys.filter((key) => key !== "capability_grants"),
    removed_keys: removedKeys,
    preserved_keys: preservedKeys,
    added_grant: {
      capability: "base.wallet.read",
      chain_id: 8453,
      ...(typeof addedGrant.expires_at === "string" ? { expires_at: addedGrant.expires_at } : {}),
      policy_hash: String(addedGrant.policy_hash ?? BANKR_READ_ONLY_GRANT_POLICY_SHA256),
    },
  };
}

function passportMatches(document: JsonRecord, passportId: string): boolean {
  return document.passport_id === undefined || String(document.passport_id) === passportId;
}

function validateExpiry(value: unknown, now?: string): boolean {
  if (value === undefined) return true;
  if (typeof value !== "string" || !value.trim()) return false;
  const expires = Date.parse(value);
  if (!Number.isFinite(expires)) return false;
  if (!now) return true;
  const current = Date.parse(now);
  return Number.isFinite(current) && expires > current;
}

export function validateReadOnlyGrantDocument(document: JsonRecord, opts: { now?: string } = {}): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const grants = grantArray(document);
  if (grants.length !== 1) issues.push("unexpected_grant_count");

  const grant = grants[0];
  if (!grant) {
    issues.push("missing_read_grant");
    return { ok: false, issues };
  }

  if (grant.capability !== READ_GRANT.capability) issues.push("grant_capability_mismatch");
  if (grant.chain_id !== READ_GRANT.chain_id) issues.push("grant_chain_id_mismatch");
  if (typeof grant.capability === "string" && DANGEROUS_CAPABILITY_RE.test(grant.capability) && grant.capability !== READ_GRANT.capability) issues.push("dangerous_grant_capability");
  if (grant.policy_hash !== undefined && grant.policy_hash !== BANKR_READ_ONLY_GRANT_POLICY_SHA256) issues.push("policy_hash_mismatch");
  if (!validateExpiry(grant.expires_at, opts.now)) issues.push("expires_at_invalid_or_expired");

  return { ok: issues.length === 0, issues };
}

export function buildReadOnlyGrantDocument(input: ReadOnlyGrantBuildInput): ReadOnlyGrantBuildResult {
  const before = stable(input.currentDocument);
  const before_sha256 = sha256(before);
  const existingGrants = grantArray(input.currentDocument);
  const dangerous = existingGrants.some((grant) => typeof grant.capability === "string" && DANGEROUS_CAPABILITY_RE.test(grant.capability) && grant.capability !== READ_GRANT.capability);
  if (dangerous) return { ok: false, reason: "dangerous sibling grant present", issues: ["dangerous_grant_capability"], before_sha256 };
  if (!passportMatches(input.currentDocument, input.passportId)) return { ok: false, reason: "passport_id mismatch", issues: ["passport_id_mismatch"], before_sha256 };

  const document = cloneDocument(input.currentDocument);
  document.passport_id = input.passportId;
  const grant: JsonRecord = { ...READ_GRANT };
  if (input.expiresAt) grant.expires_at = input.expiresAt;
  grant.policy_hash = input.policyHash ?? BANKR_READ_ONLY_GRANT_POLICY_SHA256;
  document.capability_grants = [grant];

  const validation = validateReadOnlyGrantDocument(document);
  if (!validation.ok) return { ok: false, reason: "patched document failed read-only grant validation", issues: validation.issues, before_sha256 };

  const after = stable(document);
  return { ok: true, document, before_sha256, after_sha256: sha256(after), grant_count: 1, semantic_diff: semanticDiff(input.currentDocument, document, grant) };
}

function dataJsonUri(document: JsonRecord): string {
  return `data:application/json;base64,${Buffer.from(stable(document), "utf8").toString("base64")}`;
}

function normalizeAddress(value: string | null | undefined): Address | undefined {
  if (!value?.trim()) return undefined;
  if (!isAddress(value)) throw new Error("invalid address");
  return getAddress(value) as Address;
}

function encodeSetAgentUri(registryAddress: Address, passportId: string, uri: string): `0x${string}` {
  if (!/^\d+$/.test(passportId)) throw new Error("passport_id must be decimal");
  return encodeFunctionData({
    abi: SET_AGENT_URI_ABI,
    functionName: "setAgentURI",
    args: [BigInt(passportId), uri],
  });
}

export function summarizeGrantUpdatePlan(input: GrantUpdatePlanInput): GrantUpdatePlanSummary {
  let registry: Address;
  let owner: Address | undefined;
  let signer: Address | undefined;
  try {
    registry = normalizeAddress(input.registryAddress)!;
    owner = normalizeAddress(input.ownerAddress);
    signer = normalizeAddress(input.signerAddress);
  } catch {
    return { status: "blocked_invalid_address", passport_id: input.passportId, chainId: input.chainId, registry_redacted: true, owner_redacted: true, signer_redacted: true };
  }

  const built = buildReadOnlyGrantDocument(input);
  if (!built.ok) {
    return {
      status: "blocked_invalid_document",
      passport_id: input.passportId,
      chainId: input.chainId,
      registry_redacted: true,
      owner_redacted: true,
      signer_redacted: true,
      before_sha256: built.before_sha256,
      planned_document: { grant_count: 0, validation_ok: false, issues: built.issues },
    };
  }

  const validation = validateReadOnlyGrantDocument(built.document);
  const baseSummary = {
    passport_id: input.passportId,
    chainId: input.chainId,
    registry_redacted: true as const,
    owner_redacted: true as const,
    signer_redacted: true as const,
    before_sha256: built.before_sha256,
    after_sha256: built.after_sha256,
    planned_document: { grant_count: built.grant_count, validation_ok: validation.ok, issues: validation.issues, semantic_diff: built.semantic_diff },
  };

  if (!owner || !signer) {
    return { ...baseSummary, status: "blocked_missing_signer", required_env: ["PASSPORT_GRANT_UPDATE_SIGNER_PRIVATE_KEY"] };
  }

  if (owner !== signer) {
    return { ...baseSummary, status: "blocked_signer_not_owner", owner_matches_signer: false };
  }

  const uri = dataJsonUri(built.document);
  const data = encodeSetAgentUri(registry, input.passportId, uri);
  return {
    ...baseSummary,
    status: "ready_to_sign",
    owner_matches_signer: true,
    transaction: {
      to: registry,
      chainId: input.chainId,
      method: "setAgentURI",
      data,
      data_sha256: sha256(data),
      value: "0x0",
      args_summary: { passport_id: input.passportId, uri_redacted: true },
    },
  };
}
