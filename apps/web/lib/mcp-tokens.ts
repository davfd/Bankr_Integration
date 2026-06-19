import { GATEWAY_URL, authHeaders } from "./gateway";

export const DEFAULT_MCP_TOKEN_EXPIRY_DAYS = 2; // beta access tokens last 48 hours by default
export const IMAGINATION_GRAPH_MCP_SCOPES = ["graph:read", "scripture:read"] as const;
export const COUNCIL_MEMORY_MCP_SCOPES = ["council_memory:read"] as const;
export type McpAccessProfile = "graph" | "council_memory";

export type McpToken = {
  id: string;
  wallet: string;
  label: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  lastUsedTool: string | null;
};

export type CreatedMcpToken = { token: string; record: McpToken };

export const GRAPH_AGENT_INSTRUCTIONS = `You have read-only access to Leonardo's Imagination Graph and scriptural-reference parallels.
Use it when the user asks about imagined inventions, motifs, speculative mechanisms, or source precedents.
First call search_graph(query). Then call graph_concept(name) before citing a graph claim.
Use scripture_reference(name) only as a read-only reference witness, not myth quarry and not proof by itself.
Remember: ConceptMentions are evidence; Concepts are clustering. Cite author, work, year, and excerpt when available.
The graph is read-only. Do not ask for writes, edits, hidden Cypher, or database credentials.`;

export const COUNCIL_MEMORY_AGENT_INSTRUCTIONS = `You have read-only access to bounded Council Memory precedent search.
Call search_council_memory(query) when you need prior Council testimony, warning precedents, or verdict summaries.
Council Memory is testimony, not truth, not raw memory, not verdict authority, and not write access.
Cite the returned precedent handles/summaries; do not imply Council Memory grants safety clearance or final truth.
This MCP path is read-only. Do not ask for writes, hidden memory dumps, private deliberations, or database credentials.`;

export const AGENT_INSTRUCTIONS = `${GRAPH_AGENT_INSTRUCTIONS}\n\n${COUNCIL_MEMORY_AGENT_INSTRUCTIONS}`;

export function graphMcpEndpoint(base: string = GATEWAY_URL): string {
  return `${base.replace(/\/$/, "")}/mcp/graph`;
}

export function graphMcpHealthEndpoint(base: string = GATEWAY_URL): string {
  return `${base.replace(/\/$/, "")}/mcp/graph/health`;
}

export function buildHermesMcpConfig(endpoint: string, token = "<paste-token-here>", serverKey = "leonardo_graph"): string {
  return `mcp_servers:\n  ${serverKey}:\n    url: "${endpoint}"\n    headers:\n      Authorization: "Bearer ${token}"\n    timeout: 120\n    connect_timeout: 30`;
}

export function buildGenericMcpConfig(endpoint: string, token = "<paste-token-here>", name = "leonardo-graph"): string {
  return JSON.stringify(
    {
      name,
      transport: "streamable_http",
      url: endpoint,
      headers: { Authorization: `Bearer ${token}` },
    },
    null,
    2,
  );
}

async function parseJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok || body.ok === false) throw new Error(body.error ?? `Gateway error (${res.status}).`);
  return body as T;
}

export async function listMcpTokens(): Promise<McpToken[]> {
  const res = await fetch(`${GATEWAY_URL}/api/mcp/tokens`, { headers: authHeaders(), cache: "no-store" });
  const body = await parseJson<{ ok: boolean; tokens: McpToken[] }>(res);
  return body.tokens;
}

export async function createMcpToken(input: { label: string; expiresInDays?: number; scopes?: string[] }): Promise<CreatedMcpToken> {
  const res = await fetch(`${GATEWAY_URL}/api/mcp/tokens`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ label: input.label, expiresInDays: input.expiresInDays ?? DEFAULT_MCP_TOKEN_EXPIRY_DAYS, scopes: input.scopes ?? ["graph:read", "scripture:read", "council_memory:read"] }),
  });
  return parseJson<CreatedMcpToken & { ok: boolean }>(res);
}

export async function revokeMcpToken(id: string): Promise<void> {
  const res = await fetch(`${GATEWAY_URL}/api/mcp/tokens/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  await parseJson<{ ok: boolean }>(res);
}

export async function rotateMcpToken(id: string): Promise<CreatedMcpToken> {
  const res = await fetch(`${GATEWAY_URL}/api/mcp/tokens/${encodeURIComponent(id)}/rotate`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson<CreatedMcpToken & { ok: boolean }>(res);
}

async function rpc(token: string, id: number, method: string, params?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(graphMcpEndpoint(), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return parseJson<Record<string, unknown>>(res);
}

function toolPayload(frame: Record<string, unknown>): Record<string, unknown> {
  const result = frame.result as { content?: Array<{ text?: string }> } | undefined;
  const text = result?.content?.[0]?.text;
  if (!text) return { ok: false, error: "empty tool result" };
  return JSON.parse(text) as Record<string, unknown>;
}

type SmokeCheck = { name: string; arguments: Record<string, unknown> };

const SMOKE_CHECKS: Record<McpAccessProfile, { expectedTools: string[]; checks: SmokeCheck[]; success: string }> = {
  graph: {
    expectedTools: ["search_graph", "graph_concept", "graph_related", "scripture_reference"],
    checks: [
      { name: "search_graph", arguments: { query: "true name" } },
      { name: "graph_concept", arguments: { name: "true name" } },
      { name: "graph_related", arguments: { name: "true name" } },
      { name: "scripture_reference", arguments: { name: "resurrection" } },
    ],
    success: "Imagination Graph MCP connected: initialize, tools/list, graph search/concept/related, and scripture-reference checks passed.",
  },
  council_memory: {
    expectedTools: ["search_council_memory"],
    checks: [{ name: "search_council_memory", arguments: { query: "agent authority", limit: 1 } }],
    success: "Council Memory MCP connected: initialize, tools/list, and bounded Council Memory search passed.",
  },
};

export async function smokeMcpToken(token: string, profile: McpAccessProfile = "graph"): Promise<{ ok: boolean; message: string }> {
  try {
    await rpc(token, 1, "initialize", { protocolVersion: "2025-06-18" });
    const listed = await rpc(token, 2, "tools/list");
    const tools = ((listed.result as { tools?: Array<{ name?: string }> } | undefined)?.tools ?? []).map((t) => t.name);
    const spec = SMOKE_CHECKS[profile];
    if (!spec.expectedTools.every((name) => tools.includes(name)) || tools.some((name) => /write|cypher|terminal|file|import|extract/i.test(String(name)))) {
      return { ok: false, message: "Tool list failed read-only check." };
    }
    const checks = await Promise.all(spec.checks.map((check, index) => rpc(token, 3 + index, "tools/call", { name: check.name, arguments: check.arguments })));
    const failed = checks.map(toolPayload).find((payload) => payload.ok === false);
    if (failed) return { ok: false, message: String(failed.error ?? "One MCP tool failed.") };
    return { ok: true, message: spec.success };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "MCP connection failed." };
  }
}
