import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGatewayApp } from "./app";
import { _resetMcpTokens } from "./mcp-tokens";
import type { CouncilReviewer } from "./council";
import { recordCouncil } from "./council-memory";
import { BANKR_READ_ONLY_GRANT_POLICY_SHA256 } from "./identity-kernel-passport-grant-update";
import type { BaseMcpApprovalStore, BaseMcpRuntime } from "./mcp-base";

const mockReviewer: CouncilReviewer = async ({ idea, seat }) => ({
  seat: seat ?? "archimedes",
  verdict: `MOCK ${idea}`,
  ms: 1,
});

function sessionToken(wallet: string): string {
  const exp = String(Date.now() + 60_000);
  const payload = `leo2.${wallet.toLowerCase()}.${exp}.holder`;
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function legacySessionToken(wallet: string): string {
  const exp = String(Date.now() + 60_000);
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(`${wallet.toLowerCase()}.${exp}`).digest("hex");
  return `${wallet.toLowerCase()}.${exp}.${sig}`;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

async function issueMcpToken(app: ReturnType<typeof createGatewayApp>, scopes: string[], wallet = "0xaaaa000000000000000000000000000000000001"): Promise<string> {
  const res = await app.request("/api/mcp/tokens", {
    method: "POST",
    headers: { "content-type": "application/json", "x-leo-session": sessionToken(wallet) },
    body: JSON.stringify({ label: "Hermes", scopes, expiresInDays: 30 }),
  });
  return String((await json(res)).token);
}

let dir: string;

beforeEach(() => {
  delete process.env.GATEWAY_TOKEN;
  dir = mkdtempSync(join(tmpdir(), "leo-mcp-routes-"));
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.MCP_TOKEN_SECRET = "test-mcp-secret";
  process.env.MCP_TOKEN_STORE = join(dir, "tokens.json");
  process.env.HISTORY_ROOT = dir;
  _resetMcpTokens();
});

afterEach(() => {
  vi.useRealTimers();
  _resetMcpTokens();
  delete process.env.SESSION_SECRET;
  delete process.env.MCP_TOKEN_SECRET;
  delete process.env.MCP_TOKEN_STORE;
  delete process.env.HISTORY_ROOT;
  delete process.env.GATEWAY_TOKEN;
  delete process.env.WORKSHOP_SIDECAR_URL;
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("gateway · Imagination Graph MCP tokens", () => {
  it("defaults beta token API expiration to 48 hours when omitted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T00:00:00.000Z"));
    const app = createGatewayApp({ meter: false, councilReview: mockReviewer, graphSearch: async () => [] });
    const wallet = "0xaaaa000000000000000000000000000000000001";

    const created = await app.request("/api/mcp/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", "x-leo-session": sessionToken(wallet) },
      body: JSON.stringify({ label: "Beta default", scopes: ["graph:read"] }),
    });

    expect(created.status).toBe(200);
    const body = await json(created);
    expect((body.record as { expiresAt: string }).expiresAt).toBe("2026-06-18T00:00:00.000Z");
  });

  it("allows Council-Memory-only tokens to use MCP health and Council Memory without graph scope", async () => {
    recordCouncil({
      topic: "Council Memory MCP tile",
      idea: "bounded precedent search",
      ruling: "ALLOW — Council Memory MCP is testimony, not truth.",
      seat: "archimedes",
      workflow: "mcp-beta",
      evidence: ["scope council_memory:read"],
    });
    const app = createGatewayApp({ meter: false, councilReview: mockReviewer, graphSearch: async () => [] });
    const wallet = "0xcccc000000000000000000000000000000000003";
    const created = await app.request("/api/mcp/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", "x-leo-session": sessionToken(wallet) },
      body: JSON.stringify({ label: "Council Memory MCP", scopes: ["council_memory:read"] }),
    });
    const token = String((await json(created)).token);

    const health = await app.request("/mcp/graph/health", { headers: { authorization: `Bearer ${token}` } });
    expect(health.status).toBe(200);

    const council = await app.request("/mcp/graph", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 76, method: "tools/call", params: { name: "search_council_memory", arguments: { query: "MCP tile", limit: 1 } } }),
    });
    expect(council.status).toBe(200);

    const graph = await app.request("/mcp/graph", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 77, method: "tools/call", params: { name: "search_graph", arguments: { query: "true name" } } }),
    });
    expect(graph.status).toBe(403);
  });

  it("keeps one active MCP token per wallet through the token API", async () => {
    const app = createGatewayApp({ meter: false, councilReview: mockReviewer, graphSearch: async () => [] });
    const wallet = "0xaaaa000000000000000000000000000000000001";
    const headers = { "content-type": "application/json", "x-leo-session": sessionToken(wallet) };

    const firstRes = await app.request("/api/mcp/tokens", {
      method: "POST",
      headers,
      body: JSON.stringify({ label: "First", scopes: ["graph:read"] }),
    });
    const first = await json(firstRes);
    const secondRes = await app.request("/api/mcp/tokens", {
      method: "POST",
      headers,
      body: JSON.stringify({ label: "Second", scopes: ["graph:read", "council_memory:read"] }),
    });
    const second = await json(secondRes);

    const oldTokenCall = await app.request("/mcp/graph", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${first.token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 70, method: "tools/list" }),
    });
    expect(oldTokenCall.status).toBe(401);

    const newTokenCall = await app.request("/mcp/graph", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${second.token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 71, method: "tools/list" }),
    });
    expect(newTokenCall.status).toBe(200);

    const listed = await json(await app.request("/api/mcp/tokens", { headers: { "x-leo-session": sessionToken(wallet) } }));
    const active = (listed.tokens as Array<{ id: string; revokedAt: string | null }>).filter((t) => !t.revokedAt);
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe((second.record as { id: string }).id);
  });

  it("requires a signed web session, creates show-once tokens, lists metadata, and revokes per wallet", async () => {
    const app = createGatewayApp({ meter: false, councilReview: mockReviewer, graphSearch: async () => [] });
    const walletA = "0xaaaa000000000000000000000000000000000001";
    const walletB = "0xbbbb000000000000000000000000000000000002";

    expect((await app.request("/api/mcp/tokens")).status).toBe(401);

    const legacy = await app.request("/api/mcp/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", "x-leo-session": legacySessionToken(walletA) },
      body: JSON.stringify({ label: "Legacy", scopes: ["graph:read"], expiresInDays: 30 }),
    });
    expect(legacy.status).toBe(401);

    const created = await app.request("/api/mcp/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", "x-leo-session": sessionToken(walletA) },
      body: JSON.stringify({ label: "Cursor", scopes: ["graph:read"], expiresInDays: 30 }),
    });
    expect(created.status).toBe(200);
    const createdBody = await json(created);
    expect(createdBody.ok).toBe(true);
    expect(createdBody.token).toMatch(/^leo_mcp_/);
    expect(JSON.stringify(createdBody.record)).not.toContain(String(createdBody.token));

    const listA = await app.request("/api/mcp/tokens", { headers: { "x-leo-session": sessionToken(walletA) } });
    const listABody = await json(listA);
    expect(listABody.ok).toBe(true);
    expect(listABody.tokens).toMatchObject([{ label: "Cursor", scopes: ["graph:read"] }]);
    expect(JSON.stringify(listABody.tokens)).not.toContain(String(createdBody.token));

    const id = (listABody.tokens as Array<{ id: string }>)[0]!.id;
    const badRevoke = await app.request(`/api/mcp/tokens/${id}`, {
      method: "DELETE",
      headers: { "x-leo-session": sessionToken(walletB) },
    });
    expect(badRevoke.status).toBe(404);

    const revoked = await app.request(`/api/mcp/tokens/${id}`, {
      method: "DELETE",
      headers: { "x-leo-session": sessionToken(walletA) },
    });
    expect(revoked.status).toBe(200);
    expect(await json(revoked)).toMatchObject({ ok: true });
  });
});

describe("gateway · public read-only Graph MCP", () => {
  function appWithGraph() {
    return createGatewayApp({
      meter: false,
      councilReview: mockReviewer,
      graphSearch: async (q) => [{ id: "concept_true_name", name: `match:${q}`, mentions: 7, domain: "identity/authority", sourceKind: "fiction" }],
    });
  }

  async function issueToken(app: ReturnType<typeof createGatewayApp>, scopes = ["graph:read", "scripture:read", "council_memory:read"], wallet = "0xaaaa000000000000000000000000000000000001"): Promise<string> {
    const res = await app.request("/api/mcp/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", "x-leo-session": sessionToken(wallet) },
      body: JSON.stringify({ label: "Hermes", scopes, expiresInDays: 30 }),
    });
    return String((await json(res)).token);
  }

  it("exposes only read-only graph tools and lets a token call search_graph", async () => {
    const app = appWithGraph();
    const token = await issueToken(app);

    const unauth = await app.request("/mcp/graph", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(unauth.status).toBe(401);

    const init = await app.request("/mcp/graph", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }),
    });
    expect(init.status).toBe(200);
    expect(await json(init)).toMatchObject({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "leonardo-graph" } } });

    const listed = await app.request("/mcp/graph", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const toolsBody = await json(listed);
    const names = ((toolsBody.result as { tools: Array<{ name: string }> }).tools).map((t) => t.name);
    expect(names).toContain("search_graph");
    expect(names).toContain("graph_concept");
    expect(names).toContain("graph_related");
    expect(names).toContain("scripture_reference");
    expect(names).toContain("search_council_memory");
    expect(names).not.toContain("request_council_plan");
    expect(names).not.toContain("request_council_audit");
    expect(names).not.toContain("request_workshop_build");
    expect(names.some((name) => /write|cypher|terminal|file|import|extract|request_/i.test(name))).toBe(false);

    const called = await app.request("/mcp/graph", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_graph", arguments: { query: "true name" } } }),
    });
    const callBody = await json(called);
    const payload = JSON.parse((((callBody.result as { content: Array<{ text: string }> }).content)[0]!).text) as { hits: Array<{ name: string }> };
    expect(payload.hits[0]!.name).toBe("match:true name");
  });

  it("lets a council_memory:read token search bounded Council Memory but not raw dumps or writes", async () => {
    recordCouncil({
      wallet: "0xaaaa000000000000000000000000000000000001",
      idea: "Council Memory MCP should expose precedent summaries without raw dumps",
      mode: "panel",
      verdicts: [{ seat: "sextus", verdict: "REPAIR until bounded read scope exists" }],
      synthesis: "REPAIR — add search_council_memory behind council_memory:read.",
    });
    const app = appWithGraph();
    const token = await issueToken(app, ["council_memory:read"]);

    const called = await app.request("/mcp/graph", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 50, method: "tools/call", params: { name: "search_council_memory", arguments: { query: "bounded read scope", limit: 2 } } }),
    });
    expect(called.status).toBe(200);
    const callBody = await json(called);
    const payload = JSON.parse((((callBody.result as { content: Array<{ text: string }> }).content)[0]!).text) as { ok: boolean; hits: Array<{ idea: string; ruling: string; score: number }> };
    expect(payload.ok).toBe(true);
    expect(payload.hits[0]!.idea).toContain("Council Memory MCP");
    expect(payload.hits[0]!.ruling).toContain("search_council_memory");
    expect(JSON.stringify(payload)).not.toContain("wallet");

    const tools = await app.request("/mcp/graph", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 51, method: "tools/list" }),
    });
    const names = (((await json(tools)).result as { tools: Array<{ name: string }> }).tools).map((t) => t.name);
    expect(names).not.toContain("remember_council_memory");
    expect(names).not.toContain("write_council_memory");
  });

  it("requires council_memory:read scope for search_council_memory", async () => {
    const app = appWithGraph();
    const graphOnlyToken = await issueToken(app, ["graph:read"], "0xaaaa000000000000000000000000000000000001");
    const councilToken = await issueToken(app, ["council_memory:read"], "0xbbbb000000000000000000000000000000000002");

    const denied = await app.request("/mcp/graph", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${graphOnlyToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 52, method: "tools/call", params: { name: "search_council_memory", arguments: { query: "authority" } } }),
    });
    expect(denied.status).toBe(403);

    const allowed = await app.request("/mcp/graph", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${councilToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 53, method: "tools/call", params: { name: "search_council_memory", arguments: { query: "authority" } } }),
    });
    expect(allowed.status).toBe(200);
  });

  it("smoke-tests every advertised sidecar-backed read tool", async () => {
    process.env.WORKSHOP_SIDECAR_URL = "http://sidecar.test";
    const sidecarCalls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      sidecarCalls.push(url);
      const body = JSON.parse(String(init?.body ?? "{}")) as { name?: string };
      if (url.endsWith("/graph/concept")) {
        return new Response(JSON.stringify({ ok: true, name: body.name, mentions: [{ author: "A", work: "W", year: 1900, excerpt: "bounded" }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/graph/related")) {
        return new Response(JSON.stringify({ ok: true, name: body.name, related: [{ name: "adjacent", together: 2 }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/graph/bible")) {
        return new Response(JSON.stringify({ ok: true, name: body.name, parallels: [{ type: "capacity", name: "Witness", tightness: 0.4 }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: false, error: "unexpected" }), { status: 404, headers: { "content-type": "application/json" } });
    });
    const app = appWithGraph();
    const token = await issueToken(app, ["graph:read", "scripture:read"]);

    async function callTool(name: string): Promise<Record<string, unknown>> {
      const res = await app.request("/mcp/graph", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: name, method: "tools/call", params: { name, arguments: { name: "true name" } } }),
      });
      expect(res.status).toBe(200);
      const body = await json(res);
      return JSON.parse((((body.result as { content: Array<{ text: string }> }).content)[0]!).text) as Record<string, unknown>;
    }

    expect(await callTool("graph_concept")).toMatchObject({ ok: true, mentions: [{ excerpt: "bounded" }] });
    expect(await callTool("graph_related")).toMatchObject({ ok: true, related: [{ name: "adjacent" }] });
    expect(await callTool("scripture_reference")).toMatchObject({ ok: true, parallels: [{ name: "Witness" }] });
    expect(sidecarCalls).toEqual(["http://sidecar.test/graph/concept", "http://sidecar.test/graph/related", "http://sidecar.test/graph/bible"]);
  });

  it("requires scripture:read scope for scripture_reference", async () => {
    process.env.WORKSHOP_SIDECAR_URL = "http://sidecar.test";
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: true, parallels: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    const app = appWithGraph();
    const graphOnlyToken = await issueToken(app, ["graph:read"], "0xaaaa000000000000000000000000000000000001");
    const scriptureToken = await issueToken(app, ["graph:read", "scripture:read"], "0xbbbb000000000000000000000000000000000002");

    const denied = await app.request("/mcp/graph", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${graphOnlyToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 40, method: "tools/call", params: { name: "scripture_reference", arguments: { name: "resurrection" } } }),
    });
    expect(denied.status).toBe(403);

    const allowed = await app.request("/mcp/graph", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${scriptureToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 41, method: "tools/call", params: { name: "scripture_reference", arguments: { name: "resurrection" } } }),
    });
    expect(allowed.status).toBe(200);
  });



  it("rejects malformed tools/call names before choosing a scope", async () => {
    const app = appWithGraph();
    const token = await issueToken(app, ["graph:read"]);

    const malformed = await app.request("/mcp/graph", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: null, arguments: { name: "resurrection" } } }),
    });
    expect(malformed.status).toBe(400);
    expect(await json(malformed)).toMatchObject({ jsonrpc: "2.0", error: { code: -32602, message: "invalid tool name" } });
  });

  it("does not require the frontend shared gateway token on /mcp/graph but rejects revoked MCP tokens", async () => {
    const app = appWithGraph();
    const token = await issueToken(app);

    process.env.GATEWAY_TOKEN = "frontend-secret";
    const valid = await app.request("/mcp/graph", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }),
    });
    expect(valid.status).toBe(200);

    const list = await json(await app.request("/api/mcp/tokens", { headers: { "x-leo-session": sessionToken("0xaaaa000000000000000000000000000000000001") } }));
    const id = (list.tokens as Array<{ id: string }>)[0]!.id;
    await app.request(`/api/mcp/tokens/${id}`, { method: "DELETE", headers: { "x-leo-session": sessionToken("0xaaaa000000000000000000000000000000000001") } });

    const revoked = await app.request("/mcp/graph", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" }),
    });
    expect(revoked.status).toBe(401);
  });

  it("keeps frontend bearer auth on token management when GATEWAY_TOKEN is set before app construction", async () => {
    process.env.GATEWAY_TOKEN = "frontend-secret";
    const app = appWithGraph();
    const wallet = "0xaaaa000000000000000000000000000000000001";

    const denied = await app.request("/api/mcp/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", "x-leo-session": sessionToken(wallet) },
      body: JSON.stringify({ label: "No frontend bearer", scopes: ["graph:read"], expiresInDays: 30 }),
    });
    expect(denied.status).toBe(401);

    const created = await app.request("/api/mcp/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer frontend-secret", "x-leo-session": sessionToken(wallet) },
      body: JSON.stringify({ label: "With frontend bearer", scopes: ["graph:read"], expiresInDays: 30 }),
    });
    expect(created.status).toBe(200);
    const token = String((await json(created)).token);

    const mcp = await app.request("/mcp/graph", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 60, method: "tools/list" }),
    });
    expect(mcp.status).toBe(200);
  });
});

describe("gateway · Passport-governed Base MCP", () => {
  const owner = "0xaaaa000000000000000000000000000000000001";
  const other = "0xbbbb000000000000000000000000000000000002";
  const agentWallet = "0xcccc000000000000000000000000000000000003";

  function appWithBaseMcp(baseMcpRuntime?: BaseMcpRuntime, baseMcpApprovalStore?: BaseMcpApprovalStore) {
    return createGatewayApp({
      meter: false,
      councilReview: mockReviewer,
      graphSearch: async () => [],
      baseMcpRuntime,
      baseMcpApprovalStore,
      identityKernelHarness: {
        resolvePassport: async ({ wallet, passport_id }) => {
          if (wallet.toLowerCase() !== owner.toLowerCase() || passport_id !== "7241") return null;
          return {
            agent_id: "leonardo-agent-7241",
            passport_id: "7241",
            agent_wallet: agentWallet,
            active_system_prompt_hash: "sha256:test-system",
            authority_scope: ["answer", "base.wallet.read"],
            risk_context: "tool_execution",
            capability_grants: [{ capability: "base.wallet.read", chain_id: 8453, policy_hash: BANKR_READ_ONLY_GRANT_POLICY_SHA256 }],
          };
        },
      },
    });
  }

  function toolPayload(body: Record<string, unknown>): Record<string, unknown> {
    const result = body.result as { content?: Array<{ text?: string }> } | undefined;
    const text = result?.content?.[0]?.text;
    if (!text) throw new Error("missing MCP tool payload");
    return JSON.parse(text) as Record<string, unknown>;
  }

  it("requires the governed Base MCP scope for health and rejects graph-only tokens", async () => {
    const app = appWithBaseMcp();
    const graphToken = await issueMcpToken(app, ["graph:read"], other);
    const baseToken = await issueMcpToken(app, ["base_mcp:governed"], owner);

    expect((await app.request("/mcp/base/health")).status).toBe(401);
    expect((await app.request("/mcp/base/health", { headers: { authorization: `Bearer ${graphToken}` } })).status).toBe(403);

    const allowed = await app.request("/mcp/base/health", { headers: { authorization: `Bearer ${baseToken}` } });
    expect(allowed.status).toBe(200);
    expect(await json(allowed)).toMatchObject({ ok: true, server: "leonardo-base-identity-kernel", guarded: true });
  });

  it("lists governed Base wrapper tools but no raw transfer/swap/approve/deploy tools", async () => {
    const app = appWithBaseMcp();
    const token = await issueMcpToken(app, ["base_mcp:governed"], owner);

    const listed = await app.request("/mcp/base", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(listed.status).toBe(200);
    const names = (((await json(listed)).result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names).toEqual([
      "read_wallet_state",
      "pay_x402_invoice",
      "publish_receipt_hash",
      "request_human_approved_contract_call",
      "execute_approved_value_movement",
      "execute_approved_asset_exchange",
      "execute_approved_contract_operation",
    ]);
    expect(names).not.toEqual(expect.arrayContaining(["transfer_token", "swap", "approve_token", "deploy_contract", "call_contract", "wallet_submit"]));
  });

  it("refuses tool calls missing passport_id before any downstream Base action", async () => {
    const app = appWithBaseMcp();
    const token = await issueMcpToken(app, ["base_mcp:governed"], owner);

    const called = await app.request("/mcp/base", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_wallet_state", arguments: { chain_id: 8453 } } }),
    });
    expect(called.status).toBe(400);
    expect(await json(called)).toMatchObject({ jsonrpc: "2.0", error: { code: -32602, message: "passport_id required" } });
  });

  it("rejects wrong wallet/passport before handling the Base MCP tool", async () => {
    const app = appWithBaseMcp();
    const token = await issueMcpToken(app, ["base_mcp:governed"], other);

    const called = await app.request("/mcp/base", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "read_wallet_state", arguments: { passport_id: "7241", chain_id: 8453 } } }),
    });
    expect(called.status).toBe(403);
  });

  it("allows read_wallet_state through the resolved passport and returns a Kernel receipt", async () => {
    const app = appWithBaseMcp();
    const token = await issueMcpToken(app, ["base_mcp:governed"], owner);

    const called = await app.request("/mcp/base", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "read_wallet_state", arguments: { passport_id: "7241", agent_wallet: agentWallet, chain_id: 8453 } } }),
    });
    expect(called.status).toBe(200);
    const payload = toolPayload(await json(called));
    expect(payload).toMatchObject({ ok: true, decision: "allow", tool: "read_wallet_state", receipt: { stage: "tool", passport_id: "7241", verdict: "allow" } });
  });

  it("calls a Bankr-style runtime only after governed token, wallet passport, and grant checks", async () => {
    const readWalletState = vi.fn(async () => ({ provider: "bankr", mode: "read_only", portfolio: { balances: [] } }));
    const app = appWithBaseMcp({ readWalletState });
    const token = await issueMcpToken(app, ["base_mcp:governed"], owner);

    const called = await app.request("/mcp/base", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "read_wallet_state", arguments: { passport_id: "7241", agent_wallet: agentWallet, chain_id: 8453 } } }),
    });
    expect(called.status).toBe(200);
    const payload = toolPayload(await json(called));
    expect(payload).toMatchObject({ ok: true, decision: "allow", tool: "read_wallet_state", result: { provider: "bankr", mode: "read_only" }, receipt: { passport_id: "7241", verdict: "allow" } });
    expect(readWalletState).toHaveBeenCalledTimes(1);

    const graphOnlyToken = await issueMcpToken(app, ["graph:read"], owner);
    const blocked = await app.request("/mcp/base", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${graphOnlyToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "read_wallet_state", arguments: { passport_id: "7241", agent_wallet: agentWallet, chain_id: 8453 } } }),
    });
    expect(blocked.status).toBe(403);
    expect(readWalletState).toHaveBeenCalledTimes(1);
  });

  it("rejects a caller-supplied agent_wallet that does not match the ERC-8004 agentWallet", async () => {
    const readWalletState = vi.fn(async () => ({ provider: "bankr", mode: "read_only" }));
    const app = appWithBaseMcp({ readWalletState });
    const token = await issueMcpToken(app, ["base_mcp:governed"], owner);

    const called = await app.request("/mcp/base", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "read_wallet_state", arguments: { passport_id: "7241", agent_wallet: other, chain_id: 8453 } },
      }),
    });

    expect(called.status).toBe(200);
    const payload = toolPayload(await json(called));
    expect(payload).toMatchObject({ ok: false, decision: "refuse", tool: "read_wallet_state" });
    expect(String(payload.reason)).toMatch(/agent_wallet/i);
    expect(readWalletState).not.toHaveBeenCalled();
  });

  it("rejects malformed caller-supplied agent_wallet before downstream runtime", async () => {
    const readWalletState = vi.fn(async () => ({ provider: "bankr", mode: "read_only" }));
    const app = appWithBaseMcp({ readWalletState });
    const token = await issueMcpToken(app, ["base_mcp:governed"], owner);

    const called = await app.request("/mcp/base", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "read_wallet_state", arguments: { passport_id: "7241", agent_wallet: "not-an-address", chain_id: 8453 } } }),
    });

    expect(called.status).toBe(200);
    const payload = toolPayload(await json(called));
    expect(payload).toMatchObject({ ok: false, decision: "refuse", tool: "read_wallet_state" });
    expect(String(payload.reason)).toMatch(/agent_wallet/i);
    expect(readWalletState).not.toHaveBeenCalled();
  });

  it("does not require the frontend shared gateway token on /mcp/base", async () => {
    process.env.GATEWAY_TOKEN = "frontend-secret";
    const app = appWithBaseMcp();
    const created = await app.request("/api/mcp/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer frontend-secret", "x-leo-session": sessionToken(owner) },
      body: JSON.stringify({ label: "Base MCP", scopes: ["base_mcp:governed"], expiresInDays: 30 }),
    });
    expect(created.status).toBe(200);
    const token = String((await json(created)).token);

    const listed = await app.request("/mcp/base", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" }),
    });
    expect(listed.status).toBe(200);
  });
});
