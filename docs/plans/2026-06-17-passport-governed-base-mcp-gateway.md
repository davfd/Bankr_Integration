# Passport-Governed Base MCP Gateway Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build the first Passport-Governed Base MCP Gateway slice: an MCP endpoint that lets agents see only governed Base wrappers, evaluates every tool call against an Identity Kernel passport and capability grants, records receipts, and denies unknown/raw Base powers.

**Architecture:** Add a new gateway module `services/gateway/src/mcp-base.ts` and route surface `/mcp/base` + `/mcp/base/health`. The route authenticates a revocable MCP bearer token with a new `base_mcp:governed` scope, resolves the caller wallet + `passport_id` through the existing Identity Kernel passport resolver, evaluates the requested governed wrapper against manifest risk + capability grant + Identity Kernel tool verdict, then calls an injected/dry-run Base runtime. Capability grants are not caller claims: in the live ERC-8004 resolver they are parsed only from the owner-verified, self-identifying passport document, and malformed grant documents fail closed. No raw transfer/swap/approve/deploy/arbitrary-call tools are exposed in the first build.

**Tech Stack:** TypeScript, Hono gateway, existing MCP token store, existing Identity Kernel package, Vitest TDD.

---

## Scope Boundaries

This first build **does**:

- add MCP scope `base_mcp:governed`;
- add `/mcp/base/health` and `/mcp/base` JSON-RPC endpoints;
- expose exactly four governed wrapper tools:
  - `read_wallet_state`
  - `pay_x402_invoice`
  - `publish_receipt_hash`
  - `request_human_approved_contract_call`
- classify tools by risk/capability;
- require passport ownership/session resolution for tool execution;
- require capability grants for spend/write/human-contract wrappers;
- produce per-call Identity Kernel receipts;
- fail closed for unknown/raw tools and missing passport resolver.

This first build **does not**:

- execute real transfers, swaps, approvals, bridge calls, or arbitrary contract calls;
- claim custom `$LEO` x402 settlement is live;
- bypass the existing wallet/passport ownership resolver;
- let the model self-declare authority through tool arguments;
- accept `capability_grants` from JSON-RPC/tool arguments, MCP token claims, or model text.

---

### Task 1: Add Base MCP scope to token system

**Objective:** Let users create scoped MCP tokens for the governed Base gateway without changing default graph token behavior.

**Files:**
- Modify: `services/gateway/src/mcp-tokens.ts`
- Modify/Test: `services/gateway/src/mcp-tokens.test.ts`

**Steps:**
1. RED: Add a test asserting `normalizeMcpScopes(["base_mcp:governed"])` succeeds and unsupported raw scopes like `base:transfer` throw.
2. Run: `pnpm exec vitest run services/gateway/src/mcp-tokens.test.ts` and verify FAIL before code change.
3. GREEN: Add `"base_mcp:governed"` to `ALLOWED_MCP_SCOPES`; keep default scope `graph:read`.
4. Run targeted test until PASS.

---

### Task 2: Add Base MCP policy engine/module

**Objective:** Create a pure, testable module for tool manifests, capability grants, decisions, and JSON-RPC handling.

**Files:**
- Create: `services/gateway/src/mcp-base.ts`
- Create/Test: `services/gateway/src/mcp-base.test.ts`
- Modify: `services/gateway/src/app.ts` type `ResolvedAgentPassport` to include optional `capability_grants`.

**Steps:**
1. RED: Add tests that `tools/list` exposes exactly the four governed wrapper tools and no `transfer`, `swap`, `approve`, `deploy`, or `call_contract` raw tools.
2. RED: Add tests that `pay_x402_invoice` refuses without a matching `base.x402.pay` capability grant.
3. RED: Add tests that `pay_x402_invoice` refuses recipients/amounts outside grant policy.
4. RED: Add tests that `read_wallet_state` can be allowed by `base.wallet.read` and returns a receipt.
5. RED: Add tests that `request_human_approved_contract_call` returns a non-executed approval envelope and receipt, not a raw transaction.
6. Run: `pnpm exec vitest run services/gateway/src/mcp-base.test.ts` and verify expected FAIL.
7. GREEN: Implement manifests, grants, risk classification, receipt generation, JSON-RPC response helpers, and default dry-run/runtime behavior.
8. Run targeted tests until PASS.

---

### Task 2A: Bind capability grants to verified passport documents

**Objective:** Close the Council-identified weak joint: spend/write authority must come from verified passport evidence, not JSON-RPC/model arguments or arbitrary token claims.

**Files:**
- Modify/Test: `services/gateway/src/identity-kernel-passport-resolver.ts`
- Modify/Test: `services/gateway/src/identity-kernel-passport-resolver.test.ts`
- Modify/Test: `services/gateway/src/mcp-base.test.ts`

**Steps:**
1. RED: Add resolver tests proving `capability_grants` are parsed only after `ownerOf` + `tokenURI` + self-identifying passport document verification.
2. RED: Add resolver tests proving malformed grant arrays fail closed.
3. RED: Add policy test proving JSON-RPC arguments cannot self-declare `capability_grants` or widen limits.
4. GREEN: Parse optional grants from the verified passport document, reject malformed grant documents, and keep `mcp-base` using only resolved server/passport state.
5. Run targeted tests until PASS.

---

### Task 3: Wire `/mcp/base` routes into gateway

**Objective:** Make the governed Base MCP available through the gateway behind MCP bearer token + passport ownership resolution.

**Files:**
- Modify: `services/gateway/src/app.ts`
- Modify/Test: `services/gateway/src/mcp-routes.test.ts`

**Steps:**
1. RED: Add route tests for:
   - `/mcp/base/health` requires `base_mcp:governed`;
   - graph-only MCP token gets `403` on Base MCP;
   - `tools/list` returns the governed wrappers;
   - `tools/call` refuses when `passport_id` is missing;
   - `tools/call` refuses wrong wallet/passport;
   - `tools/call` allows `read_wallet_state` when resolver returns matching passport + grant.
2. Run: `pnpm exec vitest run services/gateway/src/mcp-routes.test.ts` and verify FAIL.
3. GREEN: Add routes, GATEWAY_TOKEN bypass for `/mcp/base` like `/mcp/graph`, bearer verification, resolver use, and handler invocation.
4. Run targeted route tests until PASS.

---

### Task 4: Update public capability matrix/copy contracts

**Objective:** Make the platform’s public capability inventory name the new Beta surface without overclaiming live onchain execution.

**Files:**
- Modify: `packages/shared/src/leo-agent-trust-capabilities.ts`
- Modify/Test: `packages/shared/src/leo-agent-trust-capabilities.test.ts`

**Steps:**
1. RED: Add a test that capability matrix contains `passport_governed_base_mcp` with status `prototype` or `beta`, scope `base_mcp:governed`, and copy saying it is governed/dry-run first and does not expose raw transfer/swap/approve/deploy.
2. Run targeted test and verify FAIL.
3. GREEN: Add the capability row.
4. Run targeted test until PASS.

---

### Task 5: Verification and Council recheck

**Objective:** Seal the implementation with receipts and visible Council review.

**Commands:**

```bash
pnpm exec vitest run services/gateway/src/mcp-tokens.test.ts services/gateway/src/mcp-base.test.ts services/gateway/src/mcp-routes.test.ts services/gateway/src/identity-kernel-passport-resolver.test.ts packages/shared/src/leo-agent-trust-capabilities.test.ts
pnpm typecheck
pnpm build
BASE_MAINNET_RPC_URL=https://base-rpc.publicnode.com pnpm test
```

**Council:**
- Post plan artifact + commit/test receipts to the origin Discord thread.
- Ask seats for `ALLOW_IMPL` / `REVISE_IMPL` on the narrow governed Base MCP slice.
- If any concrete `REVISE_IMPL` is valid, patch under TDD, rerun verification, and post a narrow delta recheck.

---
