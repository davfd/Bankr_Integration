import { createSessionToken } from "./chat/freebies";
import { BASE_MCP_SCOPE, BASE_MCP_TOOLS } from "./mcp-base";
import { bankrReadinessFromEnv, safeBankrReceiptJson, type BankrReadinessReceipt } from "./bankr-readiness";

export const BANKR_LIVE_SMOKE_EXPECTED_TOOLS = BASE_MCP_TOOLS.map((tool) => tool.name) as string[];

const DEFAULT_CHAIN_ID = 8453;
const TOKEN_RE = /leo_mcp_[A-Za-z0-9_-]+/g;
const BANKR_KEY_RE = /bk_[A-Za-z0-9_-]+/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+\/-]+/gi;
const SESSION_HEADER_RE = /x-leo-session:\s*[^\s"'}]+/gi;
const RAW_WRITE_TOOL_RE = /(^|[_\-/\s.])(transfer|swap|sign|submit|approve|deploy|bridge)($|[_\-/\s.])|wallet[_\-/\s.](sign|submit|transfer|swap)|(^|[_\-/\s.])agent($|[_\-/\s.])|\/agent\//i;
const RAW_BODY_KEYS = new Set(["raw_result_body", "bankr_wallet", "portfolio", "balances", "headers", "request_headers", "response_body"]);
const PUBLIC_TOKEN_RECEIPT_KEYS = new Set([
  "active_mcp_token_count",
  "acknowledged_existing_mcp_token_revocation",
  "token_create_status",
  "revoked_token",
]);

type JsonRpcFrame = { result?: { serverInfo?: { name?: string }; tools?: Array<{ name?: string }>; content?: Array<{ text?: string }> }; error?: unknown };
type SmokeToken = { token: string; id: string };

export type BankrLiveSmokeStatus =
  | "pass"
  | "fail"
  | "ready_not_run"
  | "blocked_missing_key"
  | "blocked_missing_config"
  | "blocked_missing_frontend_bearer"
  | "blocked_existing_active_token"
  | "blocked_token_create_unauthorized"
  | "blocked_token_create_failed";

export type BankrLiveSmokeInputs = {
  readiness: Pick<BankrReadinessReceipt, "configured" | "mode" | "reason" | "governed_writes" | "receipt_publish" | "x402_payment">;
  activeMcpTokenCount?: number;
  acknowledgedExistingMcpTokenRevocation?: boolean;
  tokenCreateStatus?: number;
  initStatus?: number;
  server?: string;
  toolsStatus?: number;
  toolNames: string[];
  readCallStatus?: number;
  readPayload?: Record<string, unknown>;
  revokedToken?: boolean;
};

export type BankrLiveSmokeReceipt = {
  ready: boolean;
  status: BankrLiveSmokeStatus;
  readiness_mode: string;
  governed_writes?: BankrReadinessReceipt["governed_writes"];
  receipt_publish?: BankrReadinessReceipt["receipt_publish"];
  x402_payment?: BankrReadinessReceipt["x402_payment"];
  blocked_reason?: string;
  missing_env?: string[];
  active_mcp_token_count?: number;
  acknowledged_existing_mcp_token_revocation: boolean;
  token_create_status?: number;
  init_status?: number;
  server: string | null;
  tools_status?: number;
  has_expected_wrappers: boolean;
  has_raw_write_tool: boolean;
  read_call_status?: number;
  read_payload_ok: boolean;
  read_decision: string | null;
  read_tool: string | null;
  result_provider: string | null;
  result_mode: string | null;
  revoked_token: boolean;
};

function stringField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const child = (value as Record<string, unknown>)[key];
  return child && typeof child === "object" ? (child as Record<string, unknown>) : {};
}

export function buildBankrLiveSmokeReceipt(input: BankrLiveSmokeInputs): BankrLiveSmokeReceipt {
  const readPayload = input.readPayload ?? {};
  const result = nestedRecord(readPayload, "result");
  const hasExpectedWrappers = BANKR_LIVE_SMOKE_EXPECTED_TOOLS.every((name) => input.toolNames.includes(name));
  const hasRawWriteTool = input.toolNames.some((name) => RAW_WRITE_TOOL_RE.test(name));
  const receipt: BankrLiveSmokeReceipt = {
    ready: false,
    status: "fail",
    readiness_mode: input.readiness.mode,
    governed_writes: input.readiness.governed_writes,
    receipt_publish: input.readiness.receipt_publish,
    x402_payment: input.readiness.x402_payment,
    blocked_reason: input.readiness.reason,
    active_mcp_token_count: input.activeMcpTokenCount,
    acknowledged_existing_mcp_token_revocation: input.acknowledgedExistingMcpTokenRevocation === true,
    token_create_status: input.tokenCreateStatus,
    init_status: input.initStatus,
    server: input.server ?? null,
    tools_status: input.toolsStatus,
    has_expected_wrappers: hasExpectedWrappers,
    has_raw_write_tool: hasRawWriteTool,
    read_call_status: input.readCallStatus,
    read_payload_ok: readPayload.ok === true,
    read_decision: stringField(readPayload.decision),
    read_tool: stringField(readPayload.tool),
    result_provider: stringField(result.provider),
    result_mode: stringField(result.mode),
    revoked_token: input.revokedToken === true,
  };

  const pass =
    input.readiness.configured === true &&
    input.readiness.mode === "read_only" &&
    input.tokenCreateStatus === 200 &&
    input.initStatus === 200 &&
    input.server === "leonardo-base-identity-kernel" &&
    input.toolsStatus === 200 &&
    hasExpectedWrappers &&
    !hasRawWriteTool &&
    input.readCallStatus === 200 &&
    receipt.read_payload_ok &&
    receipt.read_decision === "allow" &&
    receipt.read_tool === "read_wallet_state" &&
    receipt.result_provider === "bankr" &&
    receipt.result_mode === "read_only" &&
    receipt.revoked_token;

  return { ...receipt, ready: pass, status: pass ? "pass" : "fail" };
}

export function bankrLiveSmokePasses(receipt: BankrLiveSmokeReceipt): boolean {
  return receipt.status === "pass" && receipt.ready === true;
}

function sanitizeForSmoke(value: unknown, key = ""): unknown {
  const lowerKey = key.toLowerCase();
  if (RAW_BODY_KEYS.has(lowerKey)) return "[REDACTED]";
  if (/api[-_ ]?key|authorization|bearer|token|session|x-leo-session|x-api-key/i.test(lowerKey) && !PUBLIC_TOKEN_RECEIPT_KEYS.has(lowerKey)) return "[REDACTED]";
  if (typeof value === "string") {
    return value.replace(TOKEN_RE, "[REDACTED]").replace(BANKR_KEY_RE, "[REDACTED]").replace(BEARER_RE, "[REDACTED]").replace(SESSION_HEADER_RE, "x-leo-session: [REDACTED]");
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeForSmoke(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, sanitizeForSmoke(childValue, childKey)]));
  }
  return value;
}

export function safeBankrLiveSmokeJson(value: unknown): string {
  return safeBankrReceiptJson(sanitizeForSmoke(value));
}

export function shouldRequireGatewayBearer(env: Record<string, string | undefined>): boolean {
  return /^(1|true|yes)$/i.test(env.BANKR_LIVE_SMOKE_REQUIRE_GATEWAY_TOKEN ?? "") || Boolean(env.GATEWAY_TOKEN?.trim());
}

export function acknowledgesExistingTokenRevocation(env: Record<string, string | undefined>): boolean {
  return /^(1|true|yes)$/i.test(env.BANKR_LIVE_SMOKE_ACK_REVOKES_EXISTING_MCP_TOKEN ?? "");
}

function gatewayBearer(env: Record<string, string | undefined>): string | undefined {
  return env.BANKR_LIVE_SMOKE_GATEWAY_TOKEN?.trim() || env.GATEWAY_TOKEN?.trim() || undefined;
}

function missingLiveConfig(env: Record<string, string | undefined>): string[] {
  return ["BANKR_LIVE_SMOKE_ENDPOINT", "BANKR_LIVE_SMOKE_WALLET", "BANKR_LIVE_SMOKE_PASSPORT_ID", "SESSION_SECRET"].filter((key) => !env[key]?.trim());
}

function blocked(status: BankrLiveSmokeStatus, reason: string, missingEnv: string[] = [], readiness: BankrReadinessReceipt = { configured: false, mode: "disabled" }, activeTokenCount?: number): BankrLiveSmokeReceipt {
  return {
    ready: false,
    status,
    readiness_mode: readiness.mode,
    governed_writes: readiness.governed_writes,
    receipt_publish: readiness.receipt_publish,
    x402_payment: readiness.x402_payment,
    blocked_reason: reason,
    missing_env: missingEnv,
    active_mcp_token_count: activeTokenCount,
    acknowledged_existing_mcp_token_revocation: false,
    server: null,
    has_expected_wrappers: false,
    has_raw_write_tool: false,
    read_payload_ok: false,
    read_decision: null,
    read_tool: null,
    result_provider: null,
    result_mode: null,
    revoked_token: false,
  };
}

export function blockedBankrLiveSmokeReceiptFromEnv(env: Record<string, string | undefined> = process.env): BankrLiveSmokeReceipt {
  const readiness = bankrReadinessFromEnv(env).receipt;
  if (!readiness.configured) {
    return blocked(readiness.mode === "invalid_config" ? "blocked_missing_config" : "blocked_missing_key", readiness.reason ?? "Bankr runtime not configured", [], readiness);
  }
  const missing = missingLiveConfig(env);
  if (missing.length > 0) return blocked("blocked_missing_config", "Bankr live smoke required config missing", missing, readiness);
  if (shouldRequireGatewayBearer(env) && !gatewayBearer(env)) {
    return blocked("blocked_missing_frontend_bearer", "gateway bearer required for /api/mcp/tokens", ["BANKR_LIVE_SMOKE_GATEWAY_TOKEN"], readiness);
  }
  return blocked("ready_not_run", "Bankr live smoke config is present but has not been executed", [], readiness);
}

export function gatewayApiBase(mcpEndpoint: string): string {
  const url = new URL(mcpEndpoint);
  url.pathname = url.pathname.replace(/\/mcp\/(base|graph)\/?$/, "") || "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function buildSessionToken(wallet: string, sessionSecret: string, expMs = Date.now() + 60_000): string {
  return createSessionToken(wallet, expMs, sessionSecret);
}

function gatewayHeaders(input: { wallet: string; sessionSecret: string; gatewayToken?: string }): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-leo-session": buildSessionToken(input.wallet, input.sessionSecret),
  };
  if (input.gatewayToken) headers.authorization = `Bearer ${input.gatewayToken}`;
  return headers;
}

type GatewayMcpTokenPublic = { revokedAt?: string | null };

export async function listGatewayBaseMcpTokens(
  mcpEndpoint: string,
  input: { wallet: string; sessionSecret: string; gatewayToken?: string },
): Promise<GatewayMcpTokenPublic[]> {
  const res = await fetch(`${gatewayApiBase(mcpEndpoint)}/api/mcp/tokens`, {
    method: "GET",
    headers: gatewayHeaders(input),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; tokens?: unknown; error?: unknown };
  if (!res.ok || body.ok !== true || !Array.isArray(body.tokens)) {
    throw new Error(`gateway MCP token list failed (${res.status}): ${String(body.error ?? "invalid response")}`);
  }
  return body.tokens.filter((item): item is GatewayMcpTokenPublic => Boolean(item) && typeof item === "object");
}

function activeMcpTokenCount(tokens: GatewayMcpTokenPublic[]): number {
  return tokens.filter((token) => token.revokedAt === null || token.revokedAt === undefined).length;
}

export async function requestGatewayBaseMcpToken(
  mcpEndpoint: string,
  input: { wallet: string; sessionSecret: string; gatewayToken?: string },
): Promise<SmokeToken> {
  const res = await fetch(`${gatewayApiBase(mcpEndpoint)}/api/mcp/tokens`, {
    method: "POST",
    headers: gatewayHeaders(input),
    body: JSON.stringify({ label: "bankr-live-smoke-base", scopes: [BASE_MCP_SCOPE], expiresInDays: 1 }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; token?: unknown; record?: { id?: unknown }; error?: unknown };
  if (!res.ok || body.ok !== true || typeof body.token !== "string" || typeof body.record?.id !== "string") {
    throw new Error(`gateway base MCP token creation failed (${res.status}): ${String(body.error ?? "invalid response")}`);
  }
  return { token: body.token, id: body.record.id };
}

export async function revokeGatewayBaseMcpToken(mcpEndpoint: string, input: { wallet: string; sessionSecret: string; gatewayToken?: string; id: string }): Promise<boolean> {
  const res = await fetch(`${gatewayApiBase(mcpEndpoint)}/api/mcp/tokens/${encodeURIComponent(input.id)}`, {
    method: "DELETE",
    headers: gatewayHeaders(input),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
  return res.ok && body.ok === true;
}

async function rpc(endpoint: string, token: string, id: number | string, method: string, params?: unknown): Promise<{ status: number; body: JsonRpcFrame }> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as JsonRpcFrame };
}

function toolPayload(frame: JsonRpcFrame): Record<string, unknown> {
  const text = frame.result?.content?.[0]?.text;
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function runBankrLiveSmoke(env: Record<string, string | undefined> = process.env): Promise<BankrLiveSmokeReceipt> {
  const readiness = bankrReadinessFromEnv(env).receipt;
  const preflight = blockedBankrLiveSmokeReceiptFromEnv(env);
  if (preflight.status !== "ready_not_run") return preflight;

  const endpoint = env.BANKR_LIVE_SMOKE_ENDPOINT!.trim();
  const wallet = env.BANKR_LIVE_SMOKE_WALLET!.trim();
  const passportId = env.BANKR_LIVE_SMOKE_PASSPORT_ID!.trim();
  const agentWallet = env.BANKR_LIVE_SMOKE_AGENT_WALLET?.trim() || wallet;
  const chainId = Number(env.BANKR_LIVE_SMOKE_CHAIN_ID ?? DEFAULT_CHAIN_ID);
  const sessionSecret = env.SESSION_SECRET!.trim();
  const bearer = gatewayBearer(env);
  const acknowledgedTokenReplacement = acknowledgesExistingTokenRevocation(env);

  let existingActiveTokens = 0;
  try {
    existingActiveTokens = activeMcpTokenCount(await listGatewayBaseMcpTokens(endpoint, { wallet, sessionSecret, gatewayToken: bearer }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const unauthorized = /\(401\)|unauthorized/i.test(message);
    return blocked(unauthorized ? "blocked_token_create_unauthorized" : "blocked_token_create_failed", unauthorized ? "temporary MCP token list unauthorized" : "temporary MCP token list failed", [], readiness);
  }
  if (existingActiveTokens > 0 && !acknowledgedTokenReplacement) {
    return blocked(
      "blocked_existing_active_token",
      "smoke wallet already has active MCP token; use a dedicated smoke wallet or set BANKR_LIVE_SMOKE_ACK_REVOKES_EXISTING_MCP_TOKEN=true",
      ["BANKR_LIVE_SMOKE_ACK_REVOKES_EXISTING_MCP_TOKEN"],
      readiness,
      existingActiveTokens,
    );
  }

  let token: SmokeToken | null = null;
  let revokedToken = false;
  let observed: Omit<BankrLiveSmokeInputs, "revokedToken"> | null = null;
  try {
    token = await requestGatewayBaseMcpToken(endpoint, { wallet, sessionSecret, gatewayToken: bearer });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const unauthorized = /\(401\)|unauthorized/i.test(message);
    return blocked(unauthorized ? "blocked_token_create_unauthorized" : "blocked_token_create_failed", unauthorized ? "temporary MCP token creation unauthorized" : "temporary MCP token creation failed", [], readiness);
  }

  try {
    const init = await rpc(endpoint, token.token, 1, "initialize", { protocolVersion: "2025-06-18" });
    const listed = await rpc(endpoint, token.token, 2, "tools/list");
    const toolNames = (listed.body.result?.tools ?? []).map((tool) => tool.name).filter((name): name is string => Boolean(name));
    const read = await rpc(endpoint, token.token, 3, "tools/call", {
      name: "read_wallet_state",
      arguments: { passport_id: passportId, agent_wallet: agentWallet, chain_id: chainId },
    });
    observed = {
      readiness,
      tokenCreateStatus: 200,
      initStatus: init.status,
      server: init.body.result?.serverInfo?.name,
      toolsStatus: listed.status,
      toolNames,
      readCallStatus: read.status,
      readPayload: toolPayload(read.body),
      activeMcpTokenCount: existingActiveTokens,
      acknowledgedExistingMcpTokenRevocation: acknowledgedTokenReplacement,
    };
  } finally {
    if (token) revokedToken = await revokeGatewayBaseMcpToken(endpoint, { wallet, sessionSecret, gatewayToken: bearer, id: token.id });
  }

  if (!observed) return blocked("blocked_token_create_failed", "Bankr live smoke did not complete", [], readiness);
  return buildBankrLiveSmokeReceipt({ ...observed, revokedToken });
}

export type BankrLiveSmokeCliInput = {
  args?: string[];
  env?: Record<string, string | undefined>;
};

export type BankrLiveSmokeCliResult = {
  receipt: BankrLiveSmokeReceipt;
  exitCode: number;
};

export async function runBankrLiveSmokeCli(input: BankrLiveSmokeCliInput = {}): Promise<BankrLiveSmokeCliResult> {
  const args = input.args ?? process.argv.slice(2);
  const env = input.env ?? process.env;
  const preflightOnly = args.includes("--preflight");
  const receipt = preflightOnly ? blockedBankrLiveSmokeReceiptFromEnv(env) : await runBankrLiveSmoke(env);
  const exitCode = preflightOnly ? 0 : bankrLiveSmokePasses(receipt) ? 0 : receipt.status.startsWith("blocked_") ? 3 : 2;
  return { receipt, exitCode };
}

async function main(): Promise<void> {
  const { receipt, exitCode } = await runBankrLiveSmokeCli();
  process.stdout.write(`${safeBankrLiveSmokeJson(receipt)}\n`);
  process.exitCode = exitCode;
}

if (process.argv[1] && /bankr-live-smoke\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    process.stderr.write(`${safeBankrLiveSmokeJson({ error: err instanceof Error ? err.message : String(err) })}\n`);
    process.exit(1);
  });
}
