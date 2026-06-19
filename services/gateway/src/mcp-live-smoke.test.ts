import { afterEach, describe, expect, it, vi } from "vitest";
import { verifySessionToken } from "./chat/freebies";
import {
  buildLiveMcpSmokeReceipt,
  buildSessionToken,
  gatewayApiBase,
  requestGatewayMcpToken,
  revokeGatewayMcpToken,
  safeJsonReceipt,
  type LiveMcpSmokeInputs,
} from "./mcp-live-smoke";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GATEWAY_TOKEN;
  delete process.env.SESSION_SECRET;
});

const okInput: LiveMcpSmokeInputs = {
  initStatus: 200,
  server: "leonardo-graph",
  toolNames: ["search_graph", "graph_concept", "graph_related", "scripture_reference", "search_council_memory"],
  councilCallStatus: 200,
  councilPayload: { ok: true, hits: [{ idea: "LIVE-SMOKE-MCP marker" }, { idea: "other" }] },
  graphOnlyCouncilStatus: 403,
  revokedFullToken: true,
  revokedGraphOnlyToken: true,
};

describe("MCP live smoke receipt", () => {
  it("summarizes the live MCP invariants without exposing tool bearer tokens", () => {
    const receipt = buildLiveMcpSmokeReceipt(okInput);

    expect(receipt).toEqual({
      init_status: 200,
      server: "leonardo-graph",
      tools_status: 200,
      has_search_council_memory: true,
      has_write_tool: false,
      council_call_status: 200,
      council_payload_ok: true,
      council_hit_count: 2,
      council_top_contains_smoke: true,
      graph_only_council_status: 403,
      revoked_full_token: true,
      revoked_graph_only_token: true,
    });

    const out = safeJsonReceipt({ ...receipt, token: "leo_mcp_should_not_print" });
    expect(out).not.toContain("leo_mcp_should_not_print");
    expect(out).toContain("[REDACTED_MCP_TOKEN]");
  });

  it("fails closed when a write-like MCP tool appears", () => {
    const receipt = buildLiveMcpSmokeReceipt({ ...okInput, toolNames: [...okInput.toolNames, "write_council_memory"] });
    expect(receipt.has_write_tool).toBe(true);
  });

  it("uses gateway API session auth for temporary smoke tokens so the live service cache sees them", async () => {
    process.env.SESSION_SECRET = "session-secret-for-live-smoke-test";
    process.env.GATEWAY_TOKEN = "gateway-secret";
    const calls: Array<{ url: string; method: string; auth?: string; session?: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: String(init?.method ?? "GET"),
        auth: (init?.headers as Record<string, string> | undefined)?.authorization,
        session: (init?.headers as Record<string, string> | undefined)?.["x-leo-session"],
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.endsWith("/api/mcp/tokens") && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true, token: "leo_mcp_live_secret", record: { id: "tok_1" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/mcp/tokens/tok_1") && init?.method === "DELETE") {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404, headers: { "content-type": "application/json" } });
    });

    expect(gatewayApiBase("http://127.0.0.1:8787/mcp/graph")).toBe("http://127.0.0.1:8787");
    const session = buildSessionToken("0xaaaa000000000000000000000000000000000001", process.env.SESSION_SECRET, Date.now() + 60_000);
    expect(verifySessionToken(session)).toBe("0xaaaa000000000000000000000000000000000001");

    const created = await requestGatewayMcpToken("http://127.0.0.1:8787/mcp/graph", {
      wallet: "0xaaaa000000000000000000000000000000000001",
      label: "live-smoke-council-memory",
      scopes: ["graph:read", "scripture:read", "council_memory:read"],
    });
    expect(created).toEqual({ token: "leo_mcp_live_secret", id: "tok_1" });
    expect(await revokeGatewayMcpToken("http://127.0.0.1:8787/mcp/graph", "0xaaaa000000000000000000000000000000000001", "tok_1")).toBe(true);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      url: "http://127.0.0.1:8787/api/mcp/tokens",
      method: "POST",
      auth: "Bearer gateway-secret",
      body: { label: "live-smoke-council-memory", scopes: ["graph:read", "scripture:read", "council_memory:read"], expiresInDays: 1 },
    });
    expect(verifySessionToken(calls[0]!.session)).toBe("0xaaaa000000000000000000000000000000000001");
    expect(calls[1]).toMatchObject({ url: "http://127.0.0.1:8787/api/mcp/tokens/tok_1", method: "DELETE", auth: "Bearer gateway-secret" });
    expect(verifySessionToken(calls[1]!.session)).toBe("0xaaaa000000000000000000000000000000000001");
  });
});
