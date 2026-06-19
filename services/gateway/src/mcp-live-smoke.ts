// Live smoke test for the public /mcp/graph surface. It creates temporary MCP
// tokens THROUGH THE RUNNING GATEWAY API, probes the running gateway, prints a
// redacted receipt, and revokes the temporary tokens. It must never print bearer
// token material.
//
// Run with the same env as the gateway, for example:
//   set -a; source services/gateway/.env.gateway.local; set +a
//   bun services/gateway/src/mcp-live-smoke.ts
import { createSessionToken } from "./chat/freebies";
import { recordCouncil } from "./council-memory";

const DEFAULT_ENDPOINT = "http://127.0.0.1:8787/mcp/graph";
const DEFAULT_WALLET = "0xaaaa000000000000000000000000000000000001";
const TOKEN_RE = /leo_mcp_[A-Za-z0-9_-]+/g;
const WRITE_TOOL_RE = /write|cypher|terminal|file|import|extract|request_/i;

type RpcFrame = { result?: { serverInfo?: { name?: string }; tools?: Array<{ name?: string }>; content?: Array<{ text?: string }> } };
type SmokeToken = { token: string; id: string };

export type LiveMcpSmokeInputs = {
  initStatus: number;
  server?: string;
  toolsStatus?: number;
  toolNames: string[];
  councilCallStatus: number;
  councilPayload: { ok?: unknown; hits?: unknown[] };
  graphOnlyCouncilStatus: number;
  revokedFullToken: boolean;
  revokedGraphOnlyToken: boolean;
};

export type LiveMcpSmokeReceipt = {
  init_status: number;
  server: string | null;
  tools_status: number;
  has_search_council_memory: boolean;
  has_write_tool: boolean;
  council_call_status: number;
  council_payload_ok: boolean;
  council_hit_count: number;
  council_top_contains_smoke: boolean;
  graph_only_council_status: number;
  revoked_full_token: boolean;
  revoked_graph_only_token: boolean;
};

export function buildLiveMcpSmokeReceipt(input: LiveMcpSmokeInputs): LiveMcpSmokeReceipt {
  const hits = Array.isArray(input.councilPayload.hits) ? input.councilPayload.hits : [];
  const topIdea = typeof (hits[0] as { idea?: unknown } | undefined)?.idea === "string" ? String((hits[0] as { idea: string }).idea) : "";
  return {
    init_status: input.initStatus,
    server: input.server ?? null,
    tools_status: input.toolsStatus ?? (input.toolNames.length > 0 ? 200 : 0),
    has_search_council_memory: input.toolNames.includes("search_council_memory"),
    has_write_tool: input.toolNames.some((name) => WRITE_TOOL_RE.test(name)),
    council_call_status: input.councilCallStatus,
    council_payload_ok: input.councilPayload.ok === true,
    council_hit_count: hits.length,
    council_top_contains_smoke: topIdea.includes("LIVE-SMOKE-MCP"),
    graph_only_council_status: input.graphOnlyCouncilStatus,
    revoked_full_token: input.revokedFullToken,
    revoked_graph_only_token: input.revokedGraphOnlyToken,
  };
}

export function receiptPasses(receipt: LiveMcpSmokeReceipt): boolean {
  return (
    receipt.init_status === 200 &&
    receipt.tools_status === 200 &&
    receipt.server === "leonardo-graph" &&
    receipt.has_search_council_memory &&
    !receipt.has_write_tool &&
    receipt.council_call_status === 200 &&
    receipt.council_payload_ok &&
    receipt.council_hit_count > 0 &&
    receipt.council_top_contains_smoke &&
    receipt.graph_only_council_status === 403 &&
    receipt.revoked_full_token &&
    receipt.revoked_graph_only_token
  );
}

export function safeJsonReceipt(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(TOKEN_RE, "[REDACTED_MCP_TOKEN]");
}

export function gatewayApiBase(mcpEndpoint: string): string {
  const url = new URL(mcpEndpoint);
  url.pathname = url.pathname.replace(/\/mcp\/graph\/?$/, "") || "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function buildSessionToken(wallet: string, secret: string | undefined, expMs = Date.now() + 60_000): string {
  return createSessionToken(wallet, expMs, secret);
}

function gatewayHeaders(wallet: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-leo-session": buildSessionToken(wallet, process.env.SESSION_SECRET),
  };
  if (process.env.GATEWAY_TOKEN) headers.authorization = `Bearer ${process.env.GATEWAY_TOKEN}`;
  return headers;
}

export async function requestGatewayMcpToken(
  mcpEndpoint: string,
  input: { wallet: string; label: string; scopes: string[] },
): Promise<SmokeToken> {
  const res = await fetch(`${gatewayApiBase(mcpEndpoint)}/api/mcp/tokens`, {
    method: "POST",
    headers: gatewayHeaders(input.wallet),
    body: JSON.stringify({ label: input.label, scopes: input.scopes, expiresInDays: 1 }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; token?: unknown; record?: { id?: unknown }; error?: unknown };
  if (!res.ok || body.ok !== true || typeof body.token !== "string" || typeof body.record?.id !== "string") {
    throw new Error(`gateway MCP token creation failed (${res.status}): ${String(body.error ?? "invalid response")}`);
  }
  return { token: body.token, id: body.record.id };
}

export async function revokeGatewayMcpToken(mcpEndpoint: string, wallet: string, id: string): Promise<boolean> {
  const res = await fetch(`${gatewayApiBase(mcpEndpoint)}/api/mcp/tokens/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: gatewayHeaders(wallet),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
  return res.ok && body.ok === true;
}

async function rpc(endpoint: string, token: string, id: number | string, method: string, params?: unknown): Promise<{ status: number; body: RpcFrame }> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as RpcFrame };
}

function toolPayload(frame: RpcFrame): { ok?: unknown; hits?: unknown[] } {
  const text = frame.result?.content?.[0]?.text;
  if (!text) return {};
  try {
    return JSON.parse(text) as { ok?: unknown; hits?: unknown[] };
  } catch {
    return {};
  }
}

export async function runLiveMcpSmoke(options: { endpoint?: string; wallet?: string; marker?: string } = {}): Promise<LiveMcpSmokeReceipt> {
  const endpoint = options.endpoint ?? process.env.MCP_LIVE_SMOKE_ENDPOINT ?? DEFAULT_ENDPOINT;
  const wallet = options.wallet ?? process.env.MCP_LIVE_SMOKE_WALLET ?? DEFAULT_WALLET;
  const marker = options.marker ?? `LIVE-SMOKE-MCP ${new Date().toISOString()}`;

  let full: SmokeToken | null = null;
  let graphOnly: SmokeToken | null = null;
  let observed: Omit<LiveMcpSmokeInputs, "revokedFullToken" | "revokedGraphOnlyToken"> | null = null;
  let revokedFullToken = false;
  let revokedGraphOnlyToken = false;

  try {
    full = await requestGatewayMcpToken(endpoint, {
      wallet,
      label: "live-smoke-council-memory",
      scopes: ["graph:read", "scripture:read", "council_memory:read"],
    });
    graphOnly = await requestGatewayMcpToken(endpoint, { wallet, label: "live-smoke-graph-only", scopes: ["graph:read"] });

    recordCouncil({
      wallet,
      idea: `${marker}: bounded read-only Council Memory MCP route`,
      mode: "panel",
      verdicts: [{ seat: "archimedes", verdict: "SMOKE ACCEPT — bounded read-only Council Memory surface is visible." }],
      synthesis: "SMOKE ACCEPT — search_council_memory is present behind council_memory:read.",
    });

    const init = await rpc(endpoint, full.token, 1, "initialize", { protocolVersion: "2025-06-18" });
    const listed = await rpc(endpoint, full.token, 2, "tools/list");
    const toolNames = (listed.body.result?.tools ?? []).map((tool) => tool.name).filter((name): name is string => Boolean(name));
    const called = await rpc(endpoint, full.token, 3, "tools/call", { name: "search_council_memory", arguments: { query: marker, limit: 2 } });
    const denied = await rpc(endpoint, graphOnly.token, 4, "tools/call", { name: "search_council_memory", arguments: { query: marker, limit: 1 } });

    observed = {
      initStatus: init.status,
      server: init.body.result?.serverInfo?.name,
      toolsStatus: listed.status,
      toolNames,
      councilCallStatus: called.status,
      councilPayload: toolPayload(called.body),
      graphOnlyCouncilStatus: denied.status,
    };
  } finally {
    if (full) revokedFullToken = await revokeGatewayMcpToken(endpoint, wallet, full.id);
    if (graphOnly) revokedGraphOnlyToken = await revokeGatewayMcpToken(endpoint, wallet, graphOnly.id);
  }

  if (!observed) throw new Error("live MCP smoke did not complete the probe before cleanup");
  return buildLiveMcpSmokeReceipt({ ...observed, revokedFullToken, revokedGraphOnlyToken });
}

async function main(): Promise<void> {
  const receipt = await runLiveMcpSmoke();
  process.stdout.write(`${safeJsonReceipt(receipt)}\n`);
  if (!receiptPasses(receipt)) process.exitCode = 2;
}

if (process.argv[1] && /mcp-live-smoke\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
