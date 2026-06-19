# Bankr Runtime Adapter

Bankr is integrated as a **downstream runtime adapter** behind Leonardo's Passport-Governed Base MCP Gateway. It is not an authority source and it is not direct model wallet power.

```text
agent / model
  -> /mcp/base with scope base_mcp:governed
  -> wallet-owned ERC-8004 passport resolver
  -> Identity Kernel + capability grant policy
  -> governed wrapper only
  -> Bankr runtime adapter, if configured
  -> receipt / refusal / non-executing disabled mode
```

## Current shipped boundary

The adapter now has a **read path plus governed-write scaffolding**:

- `read_wallet_state` may call Bankr `GET /wallet/me` and `GET /wallet/portfolio?chains=base` after the passport/grant checks pass.
- `execute_approved_value_movement` can map to Bankr `POST /wallet/transfer`, but only by `approval_id`: the recipient/asset/amount body must live in a sealed server-side Approval Authority record, not in model arguments.
- `execute_approved_asset_exchange` can map to Bankr `POST /wallet/swap`, but only by `approval_id`: the token pair/amount/min-buy body must live in a sealed server-side Approval Authority record, not in model arguments.
- `execute_approved_contract_operation` can map to Bankr `POST /wallet/submit`, but only by `approval_id`: the raw transaction body/calldata must live in `BANKR_APPROVAL_STORE_PATH` or an injected approval store, not in model arguments.
- `publish_receipt_hash` can post a hash-only attestation to a configured Bankr API path via `BANKR_RECEIPT_PUBLISH_PATH`; it remains disabled when unset and never forwards raw private logs.
- Bankr REST auth uses the documented `X-API-Key` header server-side.
- Missing `BANKR_API_KEY` installs no Bankr runtime; it does not fabricate wallet data.
- Bankr governed writes are disabled by default. The adapter returns `bankr_governed_writes_disabled` and does not call write endpoints unless `BANKR_GOVERNED_WRITES_ENABLED=true` is set server-side.
- `pay_x402_invoice` can map to a configured Bankr x402 payment API path, but only when `BANKR_X402_PAYMENTS_ENABLED=true` and `BANKR_X402_PAYMENT_PATH` are both set server-side. It remains disabled by default.

## Not exposed

The model-visible MCP surface still does **not** include raw Bankr powers:

- no raw `/wallet/sign`;
- no raw `/wallet/submit`;
- no raw `/wallet/transfer` tool;
- no raw `/wallet/swap` tool;
- no raw `/wallet/submit` tool or model-supplied transaction body;
- no legacy `/agent/*` runtime path;
- no Bankr Agent API natural-language write execution.

Dangerous Bankr actions must remain typed governed wrappers. Raw endpoint names and arbitrary natural-language wallet execution stay outside the model-facing surface.

## Skill catalog guardrail

The Bankr skill scanner treats a skill package as more than `SKILL.md`. It scans:

- `SKILL.md`
- `references/**`
- `scripts/**`

It ignores `.git`, `node_modules`, env files, build output, binary files, and large files. Scan findings and capability templates are descriptive only. They cannot create or widen passport `capability_grants`. A package with any dangerous, stale, agent-write, or unknown finding emits **no** capability template, even if the same package also contains safe read endpoints.

## Activation and live-smoke proof

Bankr activation is operator evidence, not model authority.

Required env names for an actual read-only live smoke:

- `BANKR_API_KEY` — use a Bankr **read-only** key for read smoke; use a non-read-only key only for separately authorized governed-write testing.
- `BANKR_API_BASE_URL` — optional; defaults to `https://api.bankr.bot`.
- `BANKR_GOVERNED_WRITES_ENABLED` — optional; default false. Only set to `true` on a controlled server when testing approved value movement/exchange/submit wrappers.
- `BANKR_X402_PAYMENTS_ENABLED` — optional; default false. Must be `true` together with `BANKR_X402_PAYMENT_PATH` before `pay_x402_invoice` can call Bankr. Passport policy must still grant `base.x402.pay`, recipient, chain, and amount.
- `BANKR_X402_PAYMENT_PATH` — optional; relative Bankr API path for x402 invoice payments, e.g. `/x402/pay` if Bankr exposes that route. Full URLs and path traversal are rejected.
- `BANKR_APPROVAL_STORE_PATH` — optional; JSON approval-store path for `execute_approved_value_movement`, `execute_approved_asset_exchange`, and `execute_approved_contract_operation`. Records must be pre-sealed/human-approved and contain the value-movement, swap, or transaction body server-side; model calls pass only `approval_id` + receipt.
- `BANKR_RECEIPT_PUBLISH_PATH` — optional; relative Bankr API path for hash-only `publish_receipt_hash` attestations, e.g. `/receipts` if Bankr exposes that route. Full URLs and path traversal are rejected. When unset, receipt publishing returns `bankr_receipt_publish_disabled` and makes no Bankr call.
- `BANKR_LIVE_SMOKE_ENDPOINT` — gateway `/mcp/base` URL.
- `BANKR_LIVE_SMOKE_WALLET` — wallet that owns the temporary MCP token and passport.
- `BANKR_LIVE_SMOKE_PASSPORT_ID` — ERC-8004 passport id already linked to the wallet.
- `BANKR_LIVE_SMOKE_AGENT_WALLET` — optional; defaults to the session wallet.
- `BANKR_LIVE_SMOKE_CHAIN_ID` — optional; defaults to Base mainnet `8453`.
- `SESSION_SECRET` — used only to create the short-lived wallet session header for token management.
- `BANKR_LIVE_SMOKE_GATEWAY_TOKEN` — required when the target gateway is locked by the frontend bearer gate. If the gateway is known locked and this is absent, the smoke must return `blocked_missing_frontend_bearer` before token creation.
- `BANKR_LIVE_SMOKE_ACK_REVOKES_EXISTING_MCP_TOKEN` — optional explicit acknowledgement. Prefer a dedicated smoke wallet/passport. If the smoke wallet already has an active MCP token, the harness blocks as `blocked_existing_active_token` unless this is set to `true`, because normal token creation revokes older active tokens for that wallet.
- `BANKR_LIVE_SMOKE_ROUTE_ENABLED=true` — optional gateway operator switch. When set on the gateway server, `POST /api/bankr/live-smoke` exposes an operator-triggered read-only live smoke route for the product status page. When unset, the route returns `bankr live smoke route disabled` and does not create tokens or call Bankr.

Smoke command shape:

```bash
# Non-mutating preflight. Prints a redacted receipt and exits 0 even when config is incomplete.
pnpm bankr:smoke:preflight

# Actual governed read-only smoke. Use only after the env above is set intentionally.
pnpm bankr:smoke:live
```

The scripts build `@leonardo/gateway` and then run the compiled smoke harness with plain Node plus `scripts/node-esm-extension-loader.mjs`; they do not require Bun or `tsx` on the operator host.

The gateway can also expose an operator-triggered read-only live smoke route: `POST /api/bankr/live-smoke`. This route is disabled unless `BANKR_LIVE_SMOKE_ROUTE_ENABLED=true` is set server-side. When enabled, it runs the same `read_wallet_state` smoke path, returns only a sanitized `bankr_live_smoke` receipt, and still performs no Bankr write, wallet signing, x402 payment, governed write execution, or `$LEO` settlement.

Expected receipt fields are summarized only: readiness mode, `governed_writes` readiness summary, `receipt_publish` readiness summary, `x402_payment` readiness summary, `active_mcp_token_count`, explicit acknowledgement flag for any existing-token replacement, server name, wrapper-list checks, read decision, `result_provider`, `result_mode`, and token-revocation status. The preflight receipt exposes `receipt_publish` and `x402_payment` readiness so an operator can verify configured adapter paths without making a Bankr call. Receipts must not print Bankr API keys, MCP tokens, session tokens, auth headers, raw Bankr wallet payloads, raw portfolio payloads, balances, raw response bodies, approval-store paths, usage-store paths, audit-log paths, or signing material.

For a non-production disposable activation/preflight dry run, `pnpm bankr:smoke:preflight` may return `blocked_missing_config` with `governed_writes.ready=true` when Approval Authority env/preflight passes but live smoke endpoint/wallet/passport/session config is still absent. That is useful operator evidence for the readiness gate; it does not authorize live writes, token creation, production env mutation, or Bankr API execution.

Failure modes are intentionally explicit:

- `blocked_missing_key` — no Bankr key; no fake wallet data.
- `blocked_missing_config` — gateway/wallet/passport/session config absent or invalid.
- `blocked_missing_frontend_bearer` — target gateway is bearer-locked but no frontend bearer was supplied.
- `blocked_existing_active_token` — the smoke wallet already has an active MCP token; use a dedicated smoke wallet/passport or explicitly acknowledge replacement.
- `blocked_token_create_unauthorized` — token-management route refused access before any Bankr read.
- `fail` — smoke ran but invariants did not pass.

This is still not production arbitrary wallet authority and not `$LEO` x402 settlement proof. Governed write wrappers require a non-read-only Bankr key, explicit server enablement, passport grants, policy allowlists/caps, and a per-action sealed Approval Authority record with `approval_hash`, `nonce`, human approval receipt, usage reservation, consume-on-accepted, and release-on-failure lifecycle before any Bankr write endpoint can be reached. Raw transfer/swap/transaction bodies from model arguments are refused before Bankr.

## $LEO and x402 non-claim

Bankr docs make custom Base ERC-20 x402 structurally plausible, but this adapter does **not** prove live `$LEO` x402 settlement. That requires a separate live endpoint, payment, and sealed receipt.
