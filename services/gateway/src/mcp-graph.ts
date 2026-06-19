import type { GraphSearcher } from "./graph";
import type { CouncilHit } from "./council-memory";

export type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

type GraphMcpDeps = {
  graphSearch: GraphSearcher;
  councilSearch?: (query: string, opts?: { limit?: number }) => CouncilHit[];
  sidecarUrl?: string;
};

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const TEXT_ARG_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Concept id or exact concept name from search_graph." },
    limit: { type: "number", description: "Optional result cap." },
  },
  required: ["name"],
  additionalProperties: false,
};

export const PUBLIC_GRAPH_MCP_TOOLS: ToolDef[] = [
  {
    name: "search_graph",
    description:
      "Search Leonardo's read-only Imagination Graph. Use this first for imagined inventions, motifs, speculative mechanisms, or source precedents. Concepts are clusters; mentions are evidence.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search phrase, e.g. 'true name', 'memory palace', 'resurrection'." },
        limit: { type: "number", description: "Optional result cap." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "graph_concept",
    description:
      "Deep-dive one graph concept and return bounded provenance: author, work, year, source kind, and excerpt when available. Call this before citing a graph claim.",
    inputSchema: TEXT_ARG_SCHEMA,
  },
  {
    name: "graph_related",
    description:
      "Return concepts that co-occur with a concept in source passages. Co-occurrence is adjacency evidence, not proof of causation.",
    inputSchema: TEXT_ARG_SCHEMA,
  },
  {
    name: "scripture_reference",
    description:
      "Read-only scriptural reference parallels from the Bible knowledge graph. This is a reference witness, not myth quarry and not proof by itself.",
    inputSchema: TEXT_ARG_SCHEMA,
  },
  {
    name: "search_council_memory",
    description:
      "Search bounded read-only Council Memory precedents and verdict summaries. Council Memory is testimony/precedent, not truth, and this tool never writes or returns raw dumps.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search phrase for prior Council precedents, warnings, or verdict summaries." },
        limit: { type: "number", description: "Optional result cap." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
];

function rpcResult(id: JsonRpcId | undefined, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: JsonRpcId | undefined, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function args(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object") return {};
  const p = params as Record<string, unknown>;
  const a = p.arguments;
  return a && typeof a === "object" ? (a as Record<string, unknown>) : {};
}

function clean(value: unknown, cap: number): string {
  return String(value ?? "").trim().slice(0, cap);
}

function textResult(payload: unknown): Record<string, unknown> {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], isError: false };
}

async function sidecar(path: string, name: string, deps: GraphMcpDeps): Promise<unknown> {
  const base = deps.sidecarUrl?.replace(/\/$/, "");
  if (!base) return { ok: false, error: "graph detail sidecar unavailable" };
  if (name.length < 2) return { ok: false, error: "name too short" };
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { ok: false, error: "graph detail unavailable" };
    return await res.json();
  } catch {
    return { ok: false, error: "graph detail unavailable" };
  }
}

async function callTool(name: string, toolArgs: Record<string, unknown>, deps: GraphMcpDeps): Promise<Record<string, unknown>> {
  if (name === "search_graph") {
    const query = clean(toolArgs.query, 128);
    const limitRaw = Number(toolArgs.limit ?? 12);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(25, Math.floor(limitRaw))) : 12;
    if (query.length < 2) return textResult({ ok: true, hits: [] });
    return textResult({ ok: true, hits: await deps.graphSearch(query, limit) });
  }
  if (name === "graph_concept") return textResult(await sidecar("/graph/concept", clean(toolArgs.name, 128), deps));
  if (name === "graph_related") return textResult(await sidecar("/graph/related", clean(toolArgs.name, 128), deps));
  if (name === "scripture_reference") return textResult(await sidecar("/graph/bible", clean(toolArgs.name, 128), deps));
  if (name === "search_council_memory") {
    const query = clean(toolArgs.query, 160);
    const limitRaw = Number(toolArgs.limit ?? 5);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(10, Math.floor(limitRaw))) : 5;
    if (query.length < 2) return textResult({ ok: true, hits: [] });
    const hits = deps.councilSearch ? deps.councilSearch(query, { limit }).slice(0, limit) : [];
    return textResult({ ok: true, hits });
  }
  return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `unknown tool: ${name}` }) }], isError: true };
}

export async function handleGraphMcpRequest(body: unknown, deps: GraphMcpDeps): Promise<Record<string, unknown> | null> {
  if (!body || typeof body !== "object") return rpcError(null, -32600, "invalid JSON-RPC request");
  const req = body as JsonRpcRequest;
  const id = req.id;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return rpcError(id, -32600, "invalid JSON-RPC request");

  if (req.method === "notifications/initialized") return null;
  if (req.method === "initialize") {
    return rpcResult(id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "leonardo-graph", version: "0.1.0" },
      instructions:
        "Read-only Imagination Graph, Scripture-reference, and Council Memory precedent access. Call search_graph first, then graph_concept before citing. ConceptMentions are evidence; Concepts are clusters. Council Memory is testimony, not truth.",
    });
  }
  if (req.method === "tools/list") return rpcResult(id, { tools: PUBLIC_GRAPH_MCP_TOOLS });
  if (req.method === "tools/call") {
    const p = req.params && typeof req.params === "object" ? (req.params as Record<string, unknown>) : {};
    const nameValue = p.name;
    if (typeof nameValue !== "string" || !nameValue.trim()) return rpcError(id, -32602, "invalid tool name");
    const toolName = clean(nameValue, 80);
    return rpcResult(id, await callTool(toolName, args(req.params), deps));
  }
  return rpcError(id, -32601, "method not found");
}

export function graphMcpToolName(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const req = body as JsonRpcRequest;
  if (req.method !== "tools/call") return req.method;
  if (!req.params || typeof req.params !== "object") return "__invalid_tool_name__";
  const name = (req.params as Record<string, unknown>).name;
  return typeof name === "string" && name.trim() ? name.slice(0, 80) : "__invalid_tool_name__";
}

export function graphMcpRequiredScope(body: unknown): "graph:read" | "scripture:read" | "council_memory:read" | Array<"graph:read" | "scripture:read" | "council_memory:read"> {
  const toolName = graphMcpToolName(body);
  if (toolName === "initialize" || toolName === "tools/list" || toolName === "notifications/initialized" || toolName === undefined) {
    return ["graph:read", "scripture:read", "council_memory:read"];
  }
  if (toolName === "scripture_reference") return "scripture:read";
  if (toolName === "search_council_memory") return "council_memory:read";
  return "graph:read";
}
