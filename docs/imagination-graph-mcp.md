# Imagination Graph MCP Access

Leonardo exposes the Imagination Graph as a **read-only MCP server** for external agents.

This closed-beta MCP surface is independent of the complete Agent Trust Stack. It is a read-only developer surface, not the whole governed system: the larger stack adds Council/Workshop intake, receipts, gates, token rails, and review loops around work that survives judgment.

The graph is mention-first:

```text
Concept -> ConceptMention -> Chunk -> Work -> Author
```

- `ConceptMention` is evidence: one extracted mention from one source chunk.
- `Concept` is clustering: a canonical grouping that may still be refined.
- The public MCP returns bounded provenance and does not expose raw Neo4j access.

## Endpoint

```text
/mcp/graph
```

Use the full gateway URL shown on `/tools/graph`.

## Authentication

Generate a developer token on `/tools/graph`.

- Tokens are shown once.
- Tokens are stored hash-only by the gateway.
- Tokens are read-only, revocable, and expire after 48 hours by default during beta.
- During beta each wallet has one active MCP token at a time; generating or rotating a token revokes prior active tokens for that wallet.
- `/tools/graph` now exposes two token tiles:
  - **Imagination Graph MCP** grants `graph:read` and `scripture:read` for graph/source provenance plus read-only scriptural-reference parallels.
  - **Council Memory MCP** grants `council_memory:read` for bounded Council precedent/testimony search only.
- Council Memory access is bounded precedent/testimony search only; it is not truth, raw memory, verdict authority, or write access.
- Gateway operators must set `MCP_TOKEN_SECRET` separately from `SESSION_SECRET`; MCP token hashes do not fall back to the web-session key.
- Send tokens only in the HTTP header:

```http
Authorization: Bearer <token>
```

Never put the token in a query string or public chat.

## Hermes config

```yaml
mcp_servers:
  leonardo_graph:
    url: "https://<gateway-domain>/mcp/graph"
    headers:
      Authorization: "Bearer <token>"
    timeout: 120
    connect_timeout: 30
```

Restart Hermes after adding the server.

## Generic Streamable HTTP MCP config

```json
{
  "name": "leonardo-graph",
  "transport": "streamable_http",
  "url": "https://<gateway-domain>/mcp/graph",
  "headers": {
    "Authorization": "Bearer <token>"
  }
}
```

## Public tools

| Tool | Use |
|---|---|
| `search_graph(query, limit?)` | Search candidate concepts. Use first. |
| `graph_concept(name, limit?)` | Retrieve bounded provenance before citing. |
| `graph_related(name, limit?)` | Find co-occurring concepts / adjacent prior art. |
| `scripture_reference(name, limit?)` | Read-only scriptural reference parallels. |
| `search_council_memory(query, limit?)` | Search bounded Council Memory precedents and verdict summaries. Council Memory is testimony/precedent, not truth. |

Not exposed:

- writes or graph mutation
- raw Cypher
- database credentials
- terminal/filesystem/browser tools
- extraction/import controls
- Council Memory writes, raw dumps, mutable memory, or private deliberation leakage

## Agent instruction blocks

### Imagination Graph MCP

```text
You have read-only access to Leonardo's Imagination Graph and scriptural-reference parallels.
Use it when the user asks about imagined inventions, motifs, speculative mechanisms, or source precedents.
First call search_graph(query). Then call graph_concept(name) before citing a graph claim.
Use scripture_reference(name) only as a read-only reference witness, not myth quarry and not proof by itself.
Remember: ConceptMentions are evidence; Concepts are clustering. Cite author, work, year, and excerpt when available.
The graph is read-only. Do not ask for writes, edits, hidden Cypher, or database credentials.
```

### Council Memory MCP

```text
You have read-only access to bounded Council Memory precedent search.
Call search_council_memory(query) when you need prior Council testimony, warning precedents, or verdict summaries.
Council Memory is testimony, not truth, not raw memory, not verdict authority, and not write access.
Cite the returned precedent handles/summaries; do not imply Council Memory grants safety clearance or final truth.
This MCP path is read-only. Do not ask for writes, hidden memory dumps, private deliberations, or database credentials.
```

## Boundary

This is not proof that every cluster is final. It is source-linked imagination access. Treat returned passages as evidence and returned concepts as working clusters.

Council Memory is testimony/precedent, not truth. Treat returned rulings as prior witness records to weigh, not authority by themselves.

The Bible/scriptural graph is a read-only reference witness. Do not flatten it into myth quarry.
