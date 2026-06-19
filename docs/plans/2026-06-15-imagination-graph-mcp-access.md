# Imagination Graph MCP Access Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Turn the current Imagination Graph tile into a public developer/agent access screen where a signed-in user can generate a token and connect an external agent to a read-only Imagination Graph MCP endpoint immediately.

**Architecture:** Reuse the graph surfaces already present: `/api/graph/search`, `services/workshop-sidecar` graph endpoints, and `services/graph-mcp/server.py`. Add token lifecycle APIs in the gateway, expose only read-only MCP tools through a token-gated remote MCP endpoint, and make `/tools/graph` an onboarding/control screen with copy-paste configs and smoke tests.

**Tech Stack:** Next.js app router, Hono gateway, Vitest, Python FastMCP + workshop sidecar, Neo4j read-only sessions, wallet session tokens, bearer MCP tokens hashed at rest.

---

## 0. Receipts from current state

Checked on 2026-06-15.

### Graph state

```text
Concepts:        577,238
ConceptMentions: 1,001,224
Chunks:          313,009
Works:           1,174
Authors:         137
Audit:           missing_constraints=[], missing_indexes=[]
Quality notes:   0 orphan chunks, 0 mentions_without_chunks, 0 mentions_without_works, 0 mentions_without_domains, 1 concept_without_mentions, 5 works_without_authors
Extraction:      313,009 candidates; 261,570 screened positive; 260,771 chunks extracted; 1,057 screened positive missing extraction
Bible KG:        52,975 nodes; 419,476 rels; read-only reference graph
```

### Platform state

```text
/home/exor/leonardo-platform
node v24.14.0
pnpm 11.6.0
bun: not installed on this host

CI=true pnpm --config.dangerouslyAllowAllBuilds=true install --frozen-lockfile: PASS
pnpm typecheck: PASS
pnpm test: PASS — 127 passed, 5 skipped
pnpm build: PASS
```

### Existing code surface

- `/apps/web/app/status/page.tsx` contains the Imagination Graph tile, but only Repro Lab is enabled in the tile loop.
- `/apps/web/components/platform/flags.ts` has `TOOLS_COMING_SOON = true`.
- `/apps/web/app/tools/graph/page.tsx` already has a search UI, hidden by `ToolShell` unless `live` is passed.
- `/services/gateway/src/app.ts` has `GET /api/graph/search` and global gateway bearer-token gate support.
- `/services/gateway/src/graph.ts` queries Neo4j in read mode.
- `/services/gateway/src/chat/tools.ts` already defines `search_graph`, `graph_concept`, `graph_related`, `graph_bible`, `council_memory` for Leonardo chat.
- `/services/graph-mcp/server.py` already exposes read-only stdio MCP tools for the internal web Leonardo ACP bridge.
- `/services/workshop-sidecar/app.py` exposes local-only graph endpoints with excerpt caps (`excerpt[:280]`).

### Real Council transport receipt

Attempted a bounded direct `realCouncilPanel` using `pnpm dlx tsx`.

- First attempt: failed because the Hermes profile HOME caused council-cc to look for persona files under `/home/exor/.hermes/profiles/leonardo/home/.openclaw/...`.
- Second attempt: retried with `HOME=/home/exor CLAUDE_CLI_PATH=/home/exor/.local/bin/claude`.
- Result: all five seats timed out at 45s; synthesis timed out at 25s. No successful Council verdict was obtained.

Therefore the Council transcript below is a **visible design Council rendered in-thread by Leonardo from the evidence above**, not a persisted council-cc deposit.

---

## 1. Visible design Council transcript

### Kallimachos — provenance / names / archive

The tile must not merely say “search.” The promised thing is stronger: every concept tied to the passage that first imagined it. Therefore the access screen should teach the agent the graph’s epistemology before giving it tools: `ConceptMention` is evidence; `Concept` is clustering; provenance is `Concept → ConceptMention → Chunk → Work → Author`. The public MCP should return IDs and source handles wherever possible, not just pretty names. Reuse the existing internal MCP names, but make the docs say: search first, then deep-dive for provenance, then widen with related concepts.

### Sextus — skeptic / security

A generated bearer token is acceptable for an MVP, but do not pretend it is complete OAuth. Current MCP authorization guidance points remote HTTP transports toward OAuth 2.1 patterns, bearer token handling, scope challenges, resource binding, and least privilege. For launch: store only token hashes, show the token once, reject query-string tokens, support revoke/rotate/expiry, rate-limit per token and IP, and ship narrow scopes. No Council memory by default; that may leak deliberative records not meant for public agents. Also: all tool descriptions and tool return values are prompt-injection surfaces; keep them short, factual, and free of imperative hidden instructions.

### Archimedes — engineer / mechanism

Do not build a second graph. The good pattern is to extract a shared graph-tool layer from `services/graph-mcp/server.py` and the workshop sidecar, then expose it two ways: stdio MCP for the internal web Leonardo, and remote Streamable HTTP MCP for external agents. Token issuance belongs in the Hono gateway because wallet sessions already live there. The remote MCP process or route should call the same local sidecar and never hold write credentials. The first release gate is a deterministic client smoke: generate token → initialize MCP → list tools → call `search_graph("true name")` → call `graph_concept(hit)` → verify provenance and no write tools.

### Philo — boundary / Scripture / harm

The phrase “fiction, myth, sacred text” is dangerous if it flattens Scripture into a quarry. The UI can still say the graph includes sacred/scriptural reference material, but the public tool description should say “read-only scriptural reference” rather than “mythic source” when the Bible KG is involved. The endpoint must not produce recipes for harm; it can expose imagined concepts and provenance, but high-risk synthesis should remain bounded by the calling agent’s safety layer and by our own tool descriptions. The gentleness is in the boundary: read-only, excerpt-capped, no operational weaponization.

### Humboldt — empirical / field test

The decisive experiment is not “does the page look good?” It is whether a cold agent with no private context can connect and use it correctly in under two minutes. Acceptance test: copy the generated Hermes MCP config into a temp profile, restart, ask: “Find graph provenance for true-name power.” The agent must call MCP, cite concept/provenance, and not hallucinate graph contents. Also run negative tests: invalid token, revoked token, expired token, missing scope, long query, burst traffic, service restart, no Neo4j leak, no write tools in discovery.

### Synthesis ruling

**ACCEPT WITH REVISIONS.** The tile should open a “Graph Access” screen, not a generic coming-soon card. MVP can use Leonardo-issued bearer tokens if they are scoped, revocable, hashed at rest, TLS-only, rate-limited, and clearly labeled as developer tokens; OAuth 2.1/PKCE is the next public-auth hardening step. The existing internal MCP and sidecar are the correct foundation. Release only when a zero-context external agent can connect, list tools, search, retrieve provenance, and understand the read-only/mention-first rules without David explaining anything.

---

## 2. Best-practice constraints to apply

Sources checked:

- MCP Authorization spec: https://modelcontextprotocol.io/specification/draft/basic/authorization
- MCP Security Best Practices: https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices
- OWASP MCP Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html

Applied rules:

1. **Remote MCP auth should be treated as a resource-server problem.** For MVP use bearer developer tokens; for public multi-client maturity, implement OAuth 2.1 with PKCE/dynamic client registration/resource metadata.
2. **Least privilege:** per-token scopes; default graph-read only.
3. **No plaintext secrets:** generated token shown once; store hash/HMAC only.
4. **No token in URL:** only `Authorization: Bearer ...`; never query params.
5. **Short-lived or expiring tokens:** default expiry; explicit “never expires” only if David approves later.
6. **Per-token and per-IP rate limits:** not only IP.
7. **Tool inventory integrity:** no write tools discoverable; schemas tight; `additionalProperties: false` where applicable.
8. **Prompt-injection awareness:** tool descriptions and returned excerpts are data, not instructions.
9. **No confused deputy:** token is bound to the graph MCP resource and wallet owner; no passthrough third-party API tokens.
10. **TLS-only public endpoint:** reject insecure public origin; preserve strict CORS for browser APIs.
11. **Audit without leaking:** log token ID/hash prefix, wallet, tool, status, latency; never log full token.
12. **Scripture boundary:** Bible KG is read-only reference; do not market it as myth fodder.

---

## 3. Product shape

### Tile behavior

Current tile:

```text
Imagination Graph
577K concepts · fiction, myth, sacred text
Search the library of human imagination — every concept tied to the passage that first imagined it.
Working: full search, free, also woven into Leonardo's chat answers.
Coming soon
```

New behavior:

```text
Imagination Graph
577K concepts · fiction, myth, scriptural reference
Human search + agent access via MCP.
Generate a read-only token and connect your agent in under 2 minutes.
Button: Get MCP access
href: /tools/graph
```

### `/tools/graph` screen layout

```text
┌────────────────────────────────────────────────────────────────────┐
│ Imagination Graph Access                                           │
│ 577K concepts · 1M mentions · read-only provenance graph            │
│ Search by hand, or give your agent read-only MCP access.            │
├────────────────────────────────────────────────────────────────────┤
│ 1. Connect wallet / signed session                                 │
│ 2. Generate token                                                   │
│    label, scopes, expiry, create, show-once token                   │
│ 3. Copy MCP config                                                  │
│    Hermes YAML, generic Streamable HTTP JSON, curl smoke            │
│ 4. Test connection                                                  │
│    list tools, search_graph("true name"), graph_concept(...)       │
│ 5. Tool contract                                                    │
│    search_graph, graph_concept, graph_related, scripture_reference  │
│ 6. Token table                                                      │
│    label, scopes, created, last_used, expires, revoke, rotate       │
└────────────────────────────────────────────────────────────────────┘
```

### Agent instruction block shown on page

```text
You have read-only access to Leonardo's Imagination Graph.
Use it when the user asks about imagined inventions, motifs, speculative mechanisms, or source precedents.
First call search_graph(query). Then call graph_concept(name) before citing a claim.
Remember: ConceptMentions are evidence; Concepts are clustering. Cite author, work, year, and excerpt when available.
The graph is read-only. Do not ask for writes, edits, or hidden database access.
Bible/scriptural results are read-only reference witnesses, not myth quarry and not proof by themselves.
```

### Public MCP tools

Default scope set: `graph:read`.

| Tool | Purpose | Public notes |
|---|---|---|
| `search_graph(query, limit?)` | Find candidate concepts | Returns concept IDs/names/mention counts/domain/source kind. |
| `graph_concept(id_or_name, limit?)` | Provenance deep dive | Returns author/work/year/source_kind/excerpt capped to 280 chars. |
| `graph_related(id_or_name, limit?)` | Adjacent prior-art concepts | Co-occurrence only; not causal proof. |
| `scripture_reference(name, limit?)` | Read-only scriptural KG parallels | Rename public-facing `graph_bible`; do not flatten Scripture into myth. |

Do **not** expose publicly in MVP:

- `council_memory` — keep internal until public-safe filtering exists.
- any write/mutation/import/extraction/Neo4j/Cypher tool.
- raw chunk retrieval beyond bounded excerpts.

---

## 4. File-level implementation tasks

### Task 1 — Open the graph tile to the access screen

**Files**

- Modify: `apps/web/app/status/page.tsx`
- Modify: `apps/web/app/tools/graph/page.tsx`

**Changes**

1. In `FEATURES`, update Imagination Graph copy:
   - `tech`: `577K concepts · fiction, myth, scriptural reference`
   - `today`: `Working: search + Leonardo chat integration. Next: read-only MCP tokens for external agents.`
   - `action`: `Get MCP access`
   - `label`: `Agent access`
2. Replace the hardcoded enable rule:

```ts
const enabled = f.name === "Repro Lab";
```

with:

```ts
const enabled = f.name === "Repro Lab" || f.name === "Imagination Graph";
```

3. Pass `live` to `ToolShell` from `apps/web/app/tools/graph/page.tsx` so it is not hidden by `TOOLS_COMING_SOON`.

**Tests**

- Add/update copy test if existing status-page tests are added.
- `pnpm typecheck`
- `pnpm test`

---

### Task 2 — Add MCP token storage and verification

**Files**

- Create: `services/gateway/src/mcp-tokens.ts`
- Test: `services/gateway/src/mcp-tokens.test.ts`

**Design**

Persistent beta storage:

```text
~/.leonardo-platform/mcp-tokens/tokens.json
```

Token record:

```ts
export type McpTokenRecord = {
  id: string;
  wallet: string;
  label: string;
  tokenHash: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  lastUsedTool: string | null;
};
```

Token format:

```text
leo_mcp_<public_id>_<random_32_bytes_base64url>
```

Rules:

- Generate with `crypto.randomBytes(32)`.
- Hash with HMAC-SHA256 using `MCP_TOKEN_SECRET`; tests can set a fixture secret.
- Store hash only; never store plaintext token.
- List returns metadata only.
- Verification rejects malformed, expired, revoked, missing-scope tokens.
- Verification updates `lastUsedAt`/`lastUsedTool` best-effort.

**Tests**

- create token returns plaintext once and stores only hash.
- list never returns plaintext.
- verify accepts exact token and rejects wrong length/wrong prefix.
- revoke rejects future use.
- expiry rejects future use.
- scope check rejects missing scope.
- token IDs are stable public handles but not secrets.

---

### Task 3 — Add gateway token lifecycle API

**Files**

- Modify: `services/gateway/src/app.ts`
- Test: `services/gateway/src/app.test.ts`
- Optional client helper: `apps/web/lib/mcp-tokens.ts`

**Routes**

```text
GET    /api/mcp/tokens
POST   /api/mcp/tokens
DELETE /api/mcp/tokens/:id
POST   /api/mcp/tokens/:id/rotate
POST   /api/mcp/test
```

Auth:

- Require valid `x-leo-session` wallet session for token management.
- `POST /api/mcp/tokens` body: `{ label, scopes?, expiresInDays? }`.
- Allowed scopes in MVP: `graph:read`, optionally `scripture:read` if we split it.
- `POST /api/mcp/test` performs a server-side smoke with the newly generated token: list tools/search/call concept.

**Tests**

- anonymous management routes return 401.
- wallet A cannot see/revoke wallet B token.
- create/list/revoke/rotate happy path.
- invalid labels/scopes rejected.
- returned create response includes token once.
- token never appears in history/usage logs.

---

### Task 4 — Public remote MCP endpoint

**Files**

- Refactor: `services/graph-mcp/server.py`
- Create: `services/graph-mcp/tools.py`
- Create: `services/graph-mcp/public_server.py` or equivalent Hono route if Python MCP HTTP auth proves awkward.
- Test: `services/graph-mcp/test_public_mcp.py` or `services/gateway/src/mcp-public.test.ts`

**Implementation approach**

1. Extract current tool bodies from `server.py` into reusable functions.
2. Keep `server.py` as stdio MCP for internal ACP.
3. Add public remote MCP transport that:
   - requires `Authorization: Bearer <token>`.
   - validates token through gateway token verifier or shared token store.
   - exposes only public graph tools.
   - maps token scopes to tool access.
   - returns 401/403 without leaking internals.
4. Public endpoint should be something stable:

```text
https://<platform-domain>/mcp/graph
```

or gateway-proxied:

```text
https://<gateway-domain>/mcp/graph
```

**MVP acceptance**

- MCP initialize succeeds with valid token.
- MCP tools/list returns only read-only tools.
- MCP tools/call works for graph search/concept/related/scripture reference.
- invalid/revoked/expired token fails before tool execution.

---

### Task 5 — Build the `/tools/graph` access UI

**Files**

- Replace or expand: `apps/web/app/tools/graph/page.tsx`
- Create: `apps/web/lib/mcp-tokens.ts`
- Optional component: `apps/web/components/platform/CopyBlock.tsx`

**UI components**

1. **Human search panel** — keep the current search.
2. **Generate token panel** — label, expiry, scopes, create.
3. **Show-once secret panel** — copy token, explicit warning.
4. **MCP config tabs**:

Hermes config:

```yaml
mcp_servers:
  leonardo_graph:
    url: "https://<gateway-domain>/mcp/graph"
    headers:
      Authorization: "Bearer leo_mcp_..."
    timeout: 120
    connect_timeout: 30
```

Generic Streamable HTTP MCP:

```json
{
  "name": "leonardo-graph",
  "transport": "streamable_http",
  "url": "https://<gateway-domain>/mcp/graph",
  "headers": {
    "Authorization": "Bearer leo_mcp_..."
  }
}
```

Curl smoke:

```bash
curl -H "Authorization: Bearer leo_mcp_..." https://<gateway-domain>/mcp/graph/health
```

5. **Agent instruction block** — copyable prompt above.
6. **Token table** — current active tokens, revoke, rotate, last used.
7. **Connection doctor** — runs server smoke and displays pass/fail.

**Tests**

- React/unit tests for token UI state.
- Copy text includes generated token only in show-once state.
- After page reload, token plaintext is gone.
- Revoke removes token from table and disables smoke.

---

### Task 6 — Documentation and public copy

**Files**

- Create: `docs/imagination-graph-mcp.md`
- Add visible link from `/tools/graph`.

Required docs sections:

1. What this is: read-only Imagination Graph access for agents.
2. What this is not: not write access, not raw DB credentials, not proof that all clusters are canonical, not paid truth.
3. Tool contract and examples.
4. Agent setup in Hermes.
5. Generic MCP setup.
6. Token safety: store securely, revoke if leaked, do not paste in public chats.
7. Provenance discipline: mentions are evidence, concepts are clustering.
8. Scripture boundary.
9. Rate limits and fair-use notes.

---

## 5. Exhaustive functionality and security test matrix

### Unit tests

```text
mcp-tokens.test.ts
- generate token with prefix and random body
- hash only, no plaintext persisted
- verify exact token
- reject malformed token
- reject wrong token
- reject expired token
- reject revoked token
- reject missing scope
- record lastUsedAt/lastUsedTool
- wallet isolation
```

### Gateway route tests

```text
app.test.ts
- GET /api/mcp/tokens requires x-leo-session
- POST /api/mcp/tokens requires x-leo-session
- create returns token once
- list omits token
- revoke blocks future use
- rotate revokes old token and returns new token once
- wallet A cannot manage wallet B token
- invalid scopes rejected
- unsafe labels rejected/capped
- logs do not include token plaintext
```

### MCP protocol tests

```text
public MCP client smoke
- no Authorization => 401
- wrong Authorization => 401
- revoked Authorization => 401
- valid token initialize => OK
- tools/list => only read-only graph tools
- tools/list => no terminal/file/write/cypher/import/extract tools
- search_graph("true name") => hits array
- graph_concept(first hit) => mentions include author/work/year/excerpt
- excerpt length <= 280 chars
- graph_related(first hit) => related array
- scripture_reference("resurrection") => read-only reference shape
- missing scripture scope => 403 if split scope is used
```

### Agent “understands instantly” smoke

Release gate script:

```text
1. Generate disposable token.
2. Write temp Hermes config with remote MCP server.
3. Start Hermes in temp profile or MCP client harness.
4. Ask: "Use Leonardo graph provenance for true-name power."
5. Pass if output includes:
   - an MCP tool call,
   - a concept or candidate,
   - author/work/year/excerpt or explicit no-match,
   - mention-first caveat,
   - no request for DB credentials.
6. Revoke token.
7. Rerun same config; pass if auth fails cleanly.
```

### Security tests

```text
- token in query string is ignored/rejected
- Authorization header redacted from errors/logs
- rate limit per token
- rate limit per IP
- 128/200 char query cap enforced consistently
- 10KB query rejected before graph call
- concurrent calls do not corrupt token store
- service restart preserves tokens and revocations
- public endpoint never exposes LEONARDO_NEO4J_PASSWORD or sidecar URL
- MCP tool schemas do not allow extra properties
- CORS remains strict for browser APIs
- TLS-only production env check
- prompt-injection fixture in excerpt is returned as quoted data, not instructions in docs/examples
```

### Load / resilience tests

```text
- 50 parallel search_graph calls with same token
- 10 parallel tokens from same wallet
- sidecar down => MCP returns honest graph unavailable, not fabricated data
- Neo4j down => honest graph unavailable, no stack trace
- token store file missing => created with safe permissions
- token store corrupted => gateway refuses to start or quarantines file, no silent open access
```

### Manual browser checks

```text
- /status tile is clickable for Imagination Graph
- /tools/graph loads despite TOOLS_COMING_SOON
- connect wallet shows token controls
- anonymous user sees explanation but cannot create token
- create token shows secret once
- refresh hides secret but token metadata remains
- copy config includes current endpoint and token
- connection doctor passes with valid token
- revoke makes connection doctor fail
```

---

## 6. Launch gates

Do not call this live until all pass:

```text
pnpm typecheck
pnpm test
pnpm build
MCP protocol smoke with valid token
MCP protocol smoke with revoked token
External-agent smoke: cold config -> graph provenance answer
Browser manual check for show-once token UX
Security log check: no token plaintext printed
```

Public copy gate:

- Do not say OAuth until OAuth exists.
- Say “developer token” / “read-only MCP token” for MVP.
- Say “read-only scriptural reference” where Bible KG is involved.
- Say Concepts are clusters; Mentions are evidence.
- Say public tool returns bounded excerpts, not raw database dumps.

---

## 7. Recommended first implementation sequence

1. Add token store + unit tests.
2. Add token management gateway routes + tests.
3. Refactor graph MCP tool layer without behavior change + stdio smoke.
4. Add public remote MCP endpoint + protocol tests.
5. Add `/tools/graph` token UI + copy blocks.
6. Enable Imagination Graph tile.
7. Run exhaustive test matrix.
8. Run cold-agent smoke.
9. Only then flip public copy from “coming soon” to “read-only agent access beta.”

---

## 8. Open decisions for David

1. Token expiry default: 30 days, 90 days, or no expiry for beta?
2. Should `scripture_reference` be included by default, or require a separate visible scope?
3. Should access require wallet connection only, or also `$LEO` holding/payment later?
4. Should public MCP include only graph tools, or eventually Council memory after a public-safe filter?

My recommendation: 30-day default, include scripture only as explicitly named read-only reference, no `$LEO` gate for first beta, no Council memory in public MCP MVP.
