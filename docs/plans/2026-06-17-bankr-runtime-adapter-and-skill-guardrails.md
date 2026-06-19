# Bankr Runtime Adapter + Skill Guardrails Implementation Plan

> **For Hermes:** Use subagent-driven-development only if the task is split; this controller run will use strict TDD for each code slice and visible Council review before final claim.

**Goal:** Build a broad Bankr integration behind the Passport-Governed Base MCP Gateway while preserving Identity Kernel as the authority boundary: Bankr gives downstream wallet/tool hands; the Kernel decides whether the named passport may use them, under what limits, with receipts.

**Architecture:** Add a Bankr runtime adapter and Bankr skill-catalog guardrail module under `services/gateway/src/`. The adapter is injected behind the existing `/mcp/base` governed wrappers and starts with safe Bankr read-only wallet state; spend/write/x402 paths remain disabled unless explicitly configured and still pass passport capability grants first. The skill-catalog module scans the full Bankr skill artifact surface — `SKILL.md`, `references/**`, and `scripts/**` — classifies endpoint/mechanic risk, flags stale legacy endpoints, detects dangerous helper scripts, and generates safe capability-grant templates without ever exposing raw `/wallet/sign`, `/wallet/submit`, transfers, swaps, or Bankr Agent API natural-language write execution to the model.

**Tech Stack:** TypeScript, Hono gateway, Vitest, existing `mcp-base.ts` wrapper policy, ERC-8004 passport resolver, Bankr public API/docs/source observations, server-side env injection only.

---

## Source Evidence Anchors

Bankr source checked before this plan:

- Local clone: `/home/exor/Leonardo/public_sources/github/BankrBot__skills`
- Repo HEAD: `427ad9b918ce32e00343f64f271d31c73cb00182`
- Skill count: `83` `SKILL.md` files.
- Key source file: `bankr/SKILL.md`.
- Relevant Bankr source facts:
  - `/wallet/me` and `/wallet/portfolio` are read endpoints.
  - `/wallet/swap-quote` is a read quote endpoint.
  - `/wallet/swap`, `/wallet/transfer`, `/wallet/sign`, `/wallet/submit` are write/dangerous endpoints.
  - Legacy `/agent/me`, `/agent/balances`, `/agent/sign`, `/agent/submit` map to `/wallet/*` and must be linted as stale.
  - Bankr keys default to read-only; write endpoints require read-write keys and enforce Bankr-side controls such as IP allowlists and recipient limits.
  - Bankr x402/custom ERC-20 support makes `$LEO` settlement plausible but not yet proven live.

## Non-negotiable Boundaries

- Do **not** add raw MCP tools for transfer, swap, approve, deploy, bridge, sign, submit, arbitrary contract call, or Bankr natural-language write execution.
- Do **not** let JSON-RPC args, MCP token claims, model text, or Bankr skill text create `capability_grants`.
- Do **not** print or return Bankr API keys, bearer headers, raw env values, private wallet keys, raw transaction data, or unredacted request headers.
- Do **not** claim live `$LEO` x402 settlement.
- Do **not** let a missing Bankr key silently downgrade into fake success. Missing config must return an explicit disabled/unconfigured mode or leave the runtime absent.
- Do keep Bankr guardrails as defense-in-depth only; they do not replace passport/session/grant/receipt enforcement.

---

## Task 1: Add artifact-complete Bankr skill-catalog classifier

**Objective:** Make Bankr skill ingestion safe before any Bankr skill text, reference file, or helper script can influence tool grants or runtime behavior.

**Files:**
- Create: `services/gateway/src/bankr-skill-catalog.ts`
- Create/Test: `services/gateway/src/bankr-skill-catalog.test.ts`

**TDD steps:**
1. RED: Add tests classifying observed endpoints across arbitrary artifact text:
   - `GET /wallet/me` => `read`, wrapper `read_wallet_state`, safe template allowed.
   - `GET /wallet/portfolio` => `read`, wrapper `read_wallet_state`, safe template allowed.
   - `POST /wallet/swap-quote` => `read_quote`, no execution wrapper in v1.
   - `POST /wallet/transfer`, `/wallet/swap`, `/wallet/sign`, `/wallet/submit` => `write_or_dangerous`, `exposedInMcp: false`.
   - `GET /agent/me` and `POST /agent/submit` => `stale_legacy`, `exposedInMcp: false`.
   - `bankr agent "Submit this transaction..."` or similar natural-language write execution => `agent_write_execution`, `exposedInMcp: false`.
2. RED: Add a sample skill directory scan test with all three file classes:
   - `SKILL.md` containing safe read text;
   - `references/bankr-signer.md` containing stale `/agent/submit`;
   - `scripts/donate.sh` containing `bankr agent` transaction submission.
   The scan must report endpoint/mechanic findings for all files, deny raw/stale/dangerous mechanics, and produce safe capability templates only from governed read surfaces.
3. RED: Add a repo-shape unit test proving the scanner walks only allowed artifact paths (`SKILL.md`, `references/**`, `scripts/**`) and ignores `.git`, `node_modules`, private env files, build output, and arbitrary binary/large files.
4. Run `pnpm exec vitest run services/gateway/src/bankr-skill-catalog.test.ts` and verify failure because module is missing.
5. GREEN: Implement pure classifier functions and filesystem scan helper.
6. Run test again and verify pass.

**Acceptance:** The classifier is descriptive evidence tooling only. It cannot mutate passport grants, cannot call Bankr, cannot widen MCP tools, and cannot bless a skill package while its first-class references/scripts contain unclassified write mechanics.

---

## Task 2: Add Bankr runtime adapter behind governed wrappers

**Objective:** Provide real downstream Bankr read-only wallet state through the existing `read_wallet_state` wrapper, while spend/write paths stay disabled unless explicitly configured and still require Identity Kernel grants.

**Files:**
- Create: `services/gateway/src/bankr-adapter.ts`
- Create/Test: `services/gateway/src/bankr-adapter.test.ts`

**TDD steps:**
1. RED: Test `createBankrRuntimeAdapter(...).readWalletState(...)` calls only:
   - `GET /wallet/me`
   - `GET /wallet/portfolio?chains=base` for chain id `8453`
   and returns sanitized `provider: "bankr"`, `mode: "read_only"`, wallet metadata, portfolio data, and a receipt reference.
2. RED: Test read requests include the documented Bankr REST auth header `X-API-Key` in outbound mocks and never return the key/header.
3. RED: Test `createBankrRuntimeFromEnv({})` returns `undefined` so no fake runtime is installed without `BANKR_API_KEY`.
4. RED: Test x402 payment runtime is disabled by default: `payX402Invoice` returns `executed:false`, `mode:"bankr_x402_disabled"`, and does not call unknown Bankr write endpoints.
5. RED: Test no runtime method ever calls `/wallet/sign`, `/wallet/submit`, `/wallet/transfer`, `/wallet/swap`, or legacy `/agent/*`.
6. Run `pnpm exec vitest run services/gateway/src/bankr-adapter.test.ts` and verify failure.
7. GREEN: Implement adapter and env factory.
8. Run tests and verify pass.

**Acceptance:** The only live Bankr HTTP calls in v1 are read-only wallet state calls. x402 remains a non-executing adapter mode until a real Bankr x402 payment API path is proven and Council-approved.

---

## Task 3: Wire Bankr runtime into the gateway server, dark by default

**Objective:** Let production/dev gateway opt into Bankr read-only runtime through env without changing the model-visible MCP surface.

**Files:**
- Modify: `services/gateway/src/serve.ts`
- Modify/Test: `services/gateway/src/bankr-adapter.test.ts` or `services/gateway/src/mcp-routes.test.ts`

**TDD steps:**
1. RED: Add env factory tests:
   - no `BANKR_API_KEY` => no Bankr runtime;
   - `BANKR_API_KEY` present => runtime object with `readWalletState` and disabled payment/write behavior;
   - `BANKR_API_BASE_URL` validates HTTPS-ish URL and rejects malformed values.
2. GREEN: Import `createBankrRuntimeFromEnv()` in `serve.ts` and pass as `baseMcpRuntime`.
3. Verify no new public route is added and `/mcp/base` still lists only the four governed wrappers.

**Acceptance:** Operators can install a Bankr read-only key server-side. The agent still only sees governed wrappers. The key never leaves the server.

---

## Task 4: Add route-level integration test for Bankr read path

**Objective:** Prove Bankr read-only adapter can be reached only after MCP scope + wallet-owned passport + capability grant checks.

**Files:**
- Modify/Test: `services/gateway/src/mcp-routes.test.ts`

**TDD steps:**
1. RED: Add test where `/mcp/base` with `base_mcp:governed`, matching wallet/passport, and `base.wallet.read` grant calls injected Bankr runtime once and returns `provider:"bankr"` with a receipt.
2. RED: Add test where graph-only token or wrong wallet does not call the Bankr runtime.
3. GREEN: Existing route code should pass, or minimally patch only if runtime injection is not propagated.

**Acceptance:** Bankr is downstream of Kernel checks, not parallel to them.

---

## Task 5: Public capability matrix and docs copy

**Objective:** Name Bankr as a beta/prototype runtime adapter without overclaiming live wallet writes or `$LEO` settlement.

**Files:**
- Modify: `packages/shared/src/leo-agent-trust-capabilities.ts`
- Modify/Test: `packages/shared/src/leo-agent-trust-capabilities.test.ts`
- Create/Modify docs: `docs/bankr-runtime-adapter.md`

**TDD steps:**
1. RED: Test capability matrix contains `bankr_runtime_adapter` with:
   - status `prototype` or `beta`;
   - network `offchain` or `base-mainnet` only if wording is careful;
   - public claim says Bankr is a downstream runtime behind Passport-Governed Base MCP;
   - rejected mechanics include raw sign/submit/transfer/swap and Bankr Agent API write execution;
   - evidence points at adapter, scanner, tests, and Bankr source clone.
2. GREEN: Add capability row and docs page.

**Acceptance:** Public copy says: Bankr integration is governed, server-side, read-only first, and not proof of live `$LEO` x402 settlement.

---

## Task 6: Final verification and receipt

**Commands:**

```bash
pnpm exec vitest run \
  services/gateway/src/bankr-skill-catalog.test.ts \
  services/gateway/src/bankr-adapter.test.ts \
  services/gateway/src/mcp-base.test.ts \
  services/gateway/src/mcp-routes.test.ts \
  packages/shared/src/leo-agent-trust-capabilities.test.ts
pnpm typecheck
pnpm build
BASE_MAINNET_RPC_URL=https://base-rpc.publicnode.com pnpm test
```

Then:

```bash
git status --short
git diff --stat
git add ...
git commit -m "feat: add governed bankr runtime adapter"
sha256sum docs/plans/2026-06-17-bankr-runtime-adapter-and-skill-guardrails.md
```

Create sealed receipt under:

`/home/exor/leonardo-platform-deliverables/<commit>-governed-bankr-runtime-adapter-receipt.txt`

Receipt must include:
- source evidence anchors;
- commit hash;
- plan hash;
- test commands/results;
- Council plan review and implementation recheck message ids;
- non-claims.

---

## Council Review Request

Plan reviewers should `REVISE_PLAN` if:

- any raw Bankr write endpoint becomes model-visible;
- Bankr skill text can create or widen `capability_grants`;
- x402/custom `$LEO` settlement is claimed without live proof;
- missing `BANKR_API_KEY` returns fake wallet data;
- Bankr API key can leak in returned payloads, receipts, logs, or tests;
- Bankr natural-language Agent API write execution is exposed;
- `/mcp/base` can call Bankr before MCP scope, passport ownership, and grants are verified.

Plan reviewers can `ALLOW_PLAN` only if Bankr remains downstream runtime, not authority source.