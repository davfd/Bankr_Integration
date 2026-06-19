import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_INSTRUCTIONS,
  COUNCIL_MEMORY_AGENT_INSTRUCTIONS,
  COUNCIL_MEMORY_MCP_SCOPES,
  GRAPH_AGENT_INSTRUCTIONS,
  IMAGINATION_GRAPH_MCP_SCOPES,
  buildGenericMcpConfig,
  buildHermesMcpConfig,
  createMcpToken,
  graphMcpEndpoint,
  smokeMcpToken,
} from "./mcp-tokens";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("web MCP token helpers", () => {
  it("builds copy-paste configs that include endpoint and token only when explicitly supplied", () => {
    const endpoint = "https://gateway.example.com/mcp/graph";
    const token = "leo_mcp_abc_secret";

    expect(graphMcpEndpoint("https://gateway.example.com")).toBe(endpoint);
    expect(buildHermesMcpConfig(endpoint, token)).toContain("leonardo_graph:");
    expect(buildHermesMcpConfig(endpoint, token)).toContain(`url: "${endpoint}"`);
    expect(buildHermesMcpConfig(endpoint, token)).toContain(`Authorization: "Bearer ${token}"`);
    expect(buildHermesMcpConfig(endpoint, token, "leonardo_council_memory")).toContain("leonardo_council_memory:");

    const generic = JSON.parse(buildGenericMcpConfig(endpoint, token)) as { name: string; url: string; headers: { Authorization: string } };
    expect(generic.name).toBe("leonardo-graph");
    expect(generic.url).toBe(endpoint);
    expect(generic.headers.Authorization).toBe(`Bearer ${token}`);

    const councilGeneric = JSON.parse(buildGenericMcpConfig(endpoint, token, "leonardo-council-memory")) as { name: string; url: string };
    expect(councilGeneric.name).toBe("leonardo-council-memory");

    expect(buildHermesMcpConfig(endpoint)).toContain("Bearer <paste-token-here>");
  });

  it("defines separate Graph and Council Memory MCP token profiles", () => {
    expect(IMAGINATION_GRAPH_MCP_SCOPES).toEqual(["graph:read", "scripture:read"]);
    expect(COUNCIL_MEMORY_MCP_SCOPES).toEqual(["council_memory:read"]);
    expect(GRAPH_AGENT_INSTRUCTIONS).toContain("search_graph");
    expect(GRAPH_AGENT_INSTRUCTIONS).toContain("scripture_reference");
    expect(GRAPH_AGENT_INSTRUCTIONS).not.toContain("search_council_memory");
    expect(COUNCIL_MEMORY_AGENT_INSTRUCTIONS).toContain("search_council_memory");
    expect(COUNCIL_MEMORY_AGENT_INSTRUCTIONS).toContain("testimony, not truth");
  });

  it("sends 48-hour beta expiry when creating a token without an explicit duration", async () => {
    let sent: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", async (_input: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        token: "leo_mcp_fixture_secret",
        record: {
          id: "tok_1",
          wallet: "0xabc",
          label: "Beta agent",
          scopes: ["graph:read", "scripture:read", "council_memory:read"],
          createdAt: "2026-06-16T00:00:00.000Z",
          expiresAt: "2026-06-18T00:00:00.000Z",
          revokedAt: null,
          lastUsedAt: null,
          lastUsedTool: null,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    await createMcpToken({ label: "Beta agent" });

    expect(sent).toMatchObject({
      label: "Beta agent",
      expiresInDays: 2,
      scopes: ["graph:read", "scripture:read", "council_memory:read"],
    });
  });

  it("teaches a cold agent mention-first read-only graph behavior", () => {
    expect(AGENT_INSTRUCTIONS).toContain("read-only");
    expect(AGENT_INSTRUCTIONS).toContain("search_graph");
    expect(AGENT_INSTRUCTIONS).toContain("graph_concept");
    expect(AGENT_INSTRUCTIONS).toContain("search_council_memory");
    expect(AGENT_INSTRUCTIONS).toContain("Council Memory");
    expect(AGENT_INSTRUCTIONS).toContain("ConceptMentions are evidence");
  });

  it("Graph connection doctor exercises graph and scripture tools without requiring Council Memory scope", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: { name?: string } };
      calls.push(body.method === "tools/call" ? String(body.params?.name) : String(body.method));
      if (body.method === "tools/list") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: ["search_graph", "graph_concept", "graph_related", "scripture_reference", "search_council_memory"].map((name) => ({ name })) } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (body.method === "tools/call") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "leonardo-graph" } } }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const out = await smokeMcpToken("leo_mcp_fixture", "graph");
    expect(out.ok).toBe(true);
    expect(calls).toEqual(["initialize", "tools/list", "search_graph", "graph_concept", "graph_related", "scripture_reference"]);
  });

  it("Council Memory connection doctor exercises only Council Memory search", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: { name?: string } };
      calls.push(body.method === "tools/call" ? String(body.params?.name) : String(body.method));
      if (body.method === "tools/list") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: ["search_graph", "graph_concept", "graph_related", "scripture_reference", "search_council_memory"].map((name) => ({ name })) } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (body.method === "tools/call") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "leonardo-graph" } } }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const out = await smokeMcpToken("leo_mcp_fixture", "council_memory");
    expect(out.ok).toBe(true);
    expect(calls).toEqual(["initialize", "tools/list", "search_council_memory"]);
  });
});
