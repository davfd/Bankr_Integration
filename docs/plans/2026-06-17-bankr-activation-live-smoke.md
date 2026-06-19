# Bankr Activation + Live-Smoke Harness Plan

## Goal

Continue the governed Bankr work by closing the next two caveats without widening authority:

1. make Bankr runtime activation observable and fail-closed when configuration is absent;
2. add a redacted live-smoke harness for the read-only Bankr path through the existing Passport-Governed Base MCP gateway.

This is **not** production deployment, not write execution, and not `$LEO` x402 settlement proof.

## Preflight state

- Platform repo HEAD before this plan: `b75dd177c0e4578587482149e3b35af730617044 fix: require clean bankr scans before templates`.
- Current local env check found no `BANKR_API_KEY` in checked platform/profile env files.
- Current graph state is healthy enough for platform claims: 1,001,224 `ConceptMention`, 577,238 `Concept`, no missing constraints/indexes, 0 orphan chunks, 0 mentions without chunks/works/domains.
- Extraction state: 313,009 candidates; 261,570 screened positive; 260,771 chunks extracted; 1,057 screened-positive chunks still missing extraction.
- Bible KG remains read-only reference: 52,975 nodes / 419,476 rels.

## Authority boundary

The activation harness must preserve:

```text
wallet session -> temporary base_mcp:governed token -> /mcp/base
  -> passport_id required
  -> wallet-owned passport resolver
  -> verified passport capability_grants
  -> Identity Kernel tool verdict + receipt
  -> Bankr read-only runtime, if configured
```

The model still sees only governed wrappers. Raw Bankr endpoints remain invisible.

## Non-negotiables

- No raw Bankr `/wallet/sign`, `/wallet/submit`, `/wallet/transfer`, `/wallet/swap` exposure.
- No legacy `/agent/*` runtime path.
- No Bankr Agent natural-language write execution.
- No transfer/swap/sign/submit/approval/bridge/arbitrary-call/token-launch execution.
- No `$LEO` x402 settlement claim.
- No Bankr API key, bearer token, MCP token, session token, raw request header, raw Bankr wallet payload, or raw portfolio payload in receipts/logs.
- Missing `BANKR_API_KEY` must return `configured:false` / `blocked`, never fake data.
- Live smoke must create temporary tokens through gateway APIs where possible and revoke them.

## Implementation tasks

### Task 1 — Bankr activation/readiness module

Create `services/gateway/src/bankr-readiness.ts` and tests.

RED tests first:

1. `bankrReadinessFromEnv({})` returns `{ configured:false, mode:"disabled", reason:"BANKR_API_KEY missing" }` and no runtime object.
2. `bankrReadinessFromEnv({ BANKR_API_KEY:"..." })` returns `{ configured:true, mode:"read_only" }` and never includes the key or headers in JSON.
3. Invalid `BANKR_API_BASE_URL` fails closed and reports config invalid without throwing raw env values into receipts.
4. Receipt redaction removes any `bk_...`, `leo_mcp_...`, `x-leo-session`, and `Authorization`-like strings.

Acceptance: operators can know whether Bankr runtime is configured without exposing secrets or installing fake success.

### Task 2 — `/mcp/base` Bankr live-smoke harness

Create `services/gateway/src/bankr-live-smoke.ts` and tests, modeled after `mcp-live-smoke.ts` but for Base MCP.

RED tests first:

1. Receipt builder passes only if:
   - init status 200;
   - server is `leonardo-base-identity-kernel`;
   - tools list contains the four governed wrappers;
   - no raw transfer/swap/sign/submit/approve/deploy/bridge/agent tools appear;
   - read call status 200;
   - parsed payload has `ok:true`, `decision:"allow"`, `tool:"read_wallet_state"`, `result.provider:"bankr"`, `result.mode:"read_only"`;
   - temporary token is revoked.
2. Receipt builder fails if raw Bankr/write-like tool names appear.
3. Safe JSON receipt redacts MCP token, session token, Bankr key, Authorization header, `X-API-Key`, and raw result body.
4. Missing required env (`BANKR_API_KEY`, gateway endpoint, wallet, passport id, session secret) yields a blocked receipt rather than a live call.
5. If the target gateway is locked by `GATEWAY_TOKEN`, missing bearer config yields `blocked_missing_frontend_bearer` before `/api/mcp/tokens` is called. This avoids misclassifying a gateway access-gate failure as a Bankr/runtime failure.
6. If the smoke wallet already has an active MCP token, live smoke yields `blocked_existing_active_token` before creating a new token unless the operator uses a dedicated smoke wallet/passport or explicitly sets `BANKR_LIVE_SMOKE_ACK_REVOKES_EXISTING_MCP_TOKEN=true`. This surfaces the platform invariant that normal MCP token creation revokes older active tokens for the same wallet. Any acknowledged replacement path must emit `acknowledged_existing_mcp_token_revocation:true` and `active_mcp_token_count` in the final redacted receipt.

Live command shape:

```bash
BANKR_LIVE_SMOKE_ENDPOINT=https://<gateway>/mcp/base \
BANKR_LIVE_SMOKE_WALLET=0x... \
BANKR_LIVE_SMOKE_PASSPORT_ID=... \
BANKR_LIVE_SMOKE_AGENT_WALLET=0x... \
# Required when the target gateway has GATEWAY_TOKEN enabled; omit only for unlocked local dev.
BANKR_LIVE_SMOKE_GATEWAY_TOKEN=<frontend-gateway-bearer> \
# Prefer a dedicated smoke wallet. Set only if you accept replacement of any existing active token for this wallet.
BANKR_LIVE_SMOKE_ACK_REVOKES_EXISTING_MCP_TOKEN=true \
bun services/gateway/src/bankr-live-smoke.ts
```

The live smoke should create a short-lived `base_mcp:governed` token via `/api/mcp/tokens` only when the gateway token-management preconditions are met: signed wallet session plus frontend bearer when the target gateway is bearer-locked, and no prior active MCP token for the same wallet unless the operator has chosen a dedicated smoke wallet or explicitly acknowledged token replacement. It then calls only `initialize`, `tools/list`, and `tools/call read_wallet_state`, then revokes the token. If required config is absent, if a preflight probe detects `/api/mcp/tokens` is bearer-gated and no bearer was provided, or if the smoke wallet already has an active token without acknowledgement, it prints a redacted blocked receipt and exits non-zero or with a clear `ready:false` status. If acknowledgement is used, the final receipt must show both `acknowledged_existing_mcp_token_revocation:true` and the observed `active_mcp_token_count`, so token replacement is never hidden.

Acceptance: once David supplies a read-only Bankr key, gateway bearer when required, a dedicated smoke wallet/passport or explicit token-replacement acknowledgement, and a passport with `base.wallet.read`, the exact smoke can produce a sealed redacted proof without revealing balances, keys, or bearer material.

### Task 3 — Operator activation doc

Patch `docs/bankr-runtime-adapter.md` with an activation section:

- required env names only, no values;
- read-only Bankr key requirement;
- no production deploy claim;
- smoke command;
- expected redacted receipt fields;
- failure modes and refusal rules.

### Task 4 — Verification and receipt

Run:

```bash
pnpm exec vitest run services/gateway/src/bankr-readiness.test.ts services/gateway/src/bankr-live-smoke.test.ts services/gateway/src/bankr-adapter.test.ts services/gateway/src/mcp-routes.test.ts
pnpm typecheck
pnpm build
BASE_MAINNET_RPC_URL=https://base-rpc.publicnode.com pnpm test
```

Then commit and seal a receipt with:

- commit SHA;
- plan hash;
- targeted test result;
- typecheck/build/full-suite result;
- live-smoke status (`blocked_missing_key` if no key is present);
- explicit non-claims.

## Council pass/revise criteria

ALLOW_PLAN only if the next slice is an activation/readiness/smoke harness and preserves the current Bankr boundary.

REVISE_PLAN if:

- live smoke can print secrets, raw Bankr portfolio, raw Bankr wallet payload, or bearer tokens;
- missing Bankr config fabricates data;
- smoke calls raw Bankr write endpoints;
- smoke bypasses MCP scope, passport ownership, or grants;
- docs imply production deployment, live write authority, or `$LEO` x402 settlement;
- activation state becomes model-visible authority rather than operator receipt evidence.
