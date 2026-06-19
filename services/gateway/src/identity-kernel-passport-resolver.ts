import type { CapabilityGrant } from "./mcp-base";

export type ResolvedErc8004Passport = {
  agent_id: string;
  passport_id: string;
  /** ERC-8004 reserved on-chain agentWallet when verified and non-zero. */
  agent_wallet?: string;
  active_system_prompt_hash: string;
  authority_scope: string[];
  risk_context?: string;
  capability_grants?: CapabilityGrant[];
};

export type Erc8004PassportClient = {
  /** Optional CAIP-style registry id: eip155:<chainId>:<identityRegistry>. Used to verify ERC-8004 registrations[]. */
  agentRegistry?: string;
  ownerOf: (passportId: string) => Promise<string | null> | string | null;
  /** Optional ERC-8004 reserved on-chain agentWallet reader. */
  getAgentWallet?: (passportId: string) => Promise<string | null> | string | null;
  tokenURI: (passportId: string) => Promise<string | null> | string | null;
  fetchPassportDocument: (uri: string) => Promise<unknown> | unknown;
};

export type ResolveErc8004PassportInput = {
  wallet: string;
  passport_id: string;
  client: Erc8004PassportClient;
};

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function sameWallet(a: string | null, b: string): boolean {
  return typeof a === "string" && normalized(a) === normalized(b);
}

function verifiedWallet(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = normalized(value);
  if (!/^0x[0-9a-f]{40}$/.test(text)) return undefined;
  if (text === `0x${"0".repeat(40)}`) return undefined;
  return text;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.map(nonEmptyString);
  if (out.some((item) => item === null)) return null;
  const strings = out as string[];
  return strings.length > 0 ? strings : null;
}

function optionalStringArray(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  return stringArray(value);
}

function optionalStringOrNumber(value: unknown): string | number | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function optionalBoolean(value: unknown): boolean | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "boolean" ? value : null;
}

function optionalChainId(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function optionalIsoDate(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  const text = nonEmptyString(value);
  if (!text) return null;
  return Number.isFinite(Date.parse(text)) ? text : null;
}

function parseCapabilityGrant(value: unknown): CapabilityGrant | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const capability = nonEmptyString(record.capability);
  if (!capability) return null;

  const chainId = optionalChainId(record.chain_id);
  const allowedRecipients = optionalStringArray(record.allowed_recipients);
  const allowedContracts = optionalStringArray(record.allowed_contracts);
  const allowedMethods = optionalStringArray(record.allowed_methods);
  const maxPerCall = optionalStringOrNumber(record.max_per_call);
  const maxPerDay = optionalStringOrNumber(record.max_per_day);
  const requiresHuman = optionalBoolean(record.requires_human);
  const expiresAt = optionalIsoDate(record.expires_at);
  const policyHash = record.policy_hash === undefined ? undefined : nonEmptyString(record.policy_hash);

  if (
    chainId === null ||
    allowedRecipients === null ||
    allowedContracts === null ||
    allowedMethods === null ||
    maxPerCall === null ||
    maxPerDay === null ||
    requiresHuman === null ||
    expiresAt === null ||
    policyHash === null
  ) {
    return null;
  }

  const grant: CapabilityGrant = { capability };
  if (chainId !== undefined) grant.chain_id = chainId;
  if (allowedRecipients !== undefined) grant.allowed_recipients = allowedRecipients;
  if (allowedContracts !== undefined) grant.allowed_contracts = allowedContracts;
  if (allowedMethods !== undefined) grant.allowed_methods = allowedMethods;
  if (maxPerCall !== undefined) grant.max_per_call = maxPerCall;
  if (maxPerDay !== undefined) grant.max_per_day = maxPerDay;
  if (requiresHuman !== undefined) grant.requires_human = requiresHuman;
  if (expiresAt !== undefined) grant.expires_at = expiresAt;
  if (policyHash !== undefined) grant.policy_hash = policyHash;
  return grant;
}

function parseCapabilityGrants(value: unknown): CapabilityGrant[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const grants = value.map(parseCapabilityGrant);
  if (grants.some((grant) => grant === null)) return null;
  return grants as CapabilityGrant[];
}

function registrationAgentIdMatches(value: unknown, passportId: string): boolean {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value) === passportId;
  if (typeof value === "bigint") return value.toString() === passportId;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim() === passportId;
  return false;
}

function hasMatchingRegistration(value: unknown, passportId: string, expectedAgentRegistry?: string): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    if (!registrationAgentIdMatches(record.agentId, passportId)) return false;
    const agentRegistry = nonEmptyString(record.agentRegistry);
    if (!expectedAgentRegistry) return Boolean(agentRegistry);
    return Boolean(agentRegistry) && normalized(agentRegistry!) === normalized(expectedAgentRegistry);
  });
}

function parsePassportDocument(document: unknown, passportId: string, wallet: string, expectedAgentRegistry?: string, verifiedAgentWallet?: string): ResolvedErc8004Passport | null {
  if (!document || typeof document !== "object") return null;
  const record = document as Record<string, unknown>;

  const claimedPassportId = nonEmptyString(record.passport_id);
  if (claimedPassportId !== null && claimedPassportId !== passportId) return null;

  const registrations = record.registrations;
  const hasRegistrationEntries = Array.isArray(registrations) && registrations.length > 0;
  const registrationMatches = hasMatchingRegistration(registrations, passportId, expectedAgentRegistry);
  if (!claimedPassportId && !registrationMatches) return null;
  if (hasRegistrationEntries && !registrationMatches) return null;

  const ownerWallet = nonEmptyString(record.owner_wallet);
  if (ownerWallet && !sameWallet(ownerWallet, wallet)) return null;

  const documentAgentWallet = nonEmptyString(record.agent_wallet);
  if (documentAgentWallet) {
    const expectedWallet = verifiedAgentWallet ?? verifiedWallet(wallet);
    if (!expectedWallet || !sameWallet(documentAgentWallet, expectedWallet)) return null;
  }

  const agentId = nonEmptyString(record.agent_id);
  const activeSystemPromptHash = nonEmptyString(record.active_system_prompt_hash);
  const authorityScope = stringArray(record.authority_scope);
  const capabilityGrants = parseCapabilityGrants(record.capability_grants);
  if (!agentId || !activeSystemPromptHash || !authorityScope || capabilityGrants === null) return null;

  const resolved: ResolvedErc8004Passport = {
    agent_id: agentId,
    passport_id: passportId,
    active_system_prompt_hash: activeSystemPromptHash,
    authority_scope: authorityScope,
    risk_context: nonEmptyString(record.risk_context) ?? "public_chat",
  };
  if (verifiedAgentWallet) resolved.agent_wallet = verifiedAgentWallet;
  if (capabilityGrants !== undefined) resolved.capability_grants = capabilityGrants;
  return resolved;
}

export async function resolveErc8004Passport(input: ResolveErc8004PassportInput): Promise<ResolvedErc8004Passport | null> {
  const passportId = input.passport_id.trim();
  const wallet = input.wallet.trim();
  if (!passportId || !wallet) return null;

  try {
    const owner = await input.client.ownerOf(passportId);
    if (!sameWallet(owner, wallet)) return null;

    const agentWallet = verifiedWallet(input.client.getAgentWallet ? await input.client.getAgentWallet(passportId) : undefined);

    const uri = await input.client.tokenURI(passportId);
    if (!uri || !uri.trim()) return null;

    const document = await input.client.fetchPassportDocument(uri.trim());
    return parsePassportDocument(document, passportId, wallet, input.client.agentRegistry, agentWallet);
  } catch {
    return null;
  }
}

export function createErc8004PassportResolver(client: Erc8004PassportClient): (input: { wallet: string; passport_id: string }) => Promise<ResolvedErc8004Passport | null> {
  return (input) => resolveErc8004Passport({ ...input, client });
}
