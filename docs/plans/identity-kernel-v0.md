# Identity Kernel v0 Implementation Plan

> **For Hermes:** Use test-driven-development and council-visible-operations. This is a parallel-lane module; do not touch any existing beta deploy, production env, production DB, or shared secret.

**Goal:** Build the first small working Identity Kernel: a true-name firewall package plus deterministic gateway hook adapter that evaluates request/context/tool/output boundaries, returns enforceable verdicts, and writes receipt hashes.

**Architecture:** `packages/identity-kernel` is a pure TypeScript policy/receipt package. `services/gateway/src/identity-kernel-gate.ts` is the gateway-side adapter that proves the runtime calls the kernel deterministically before the LLM, before retrieved/memory context admission, before risky tools, and before final output. The LLM never chooses whether to call the checker.

**Tech Stack:** pnpm workspace, TypeScript composite package, Vitest tests, Node crypto SHA-256 receipts.

---

## Non-negotiable parallel-lane guardrails

- No edits to David's existing beta repo unless explicitly named.
- No shared production env or keys.
- No production DB/storage migrations.
- No live payment/x402 coupling in this slice.
- No beta dependency on Identity Kernel until Council + test receipts pass.
- This slice is package + adapter + tests, not a marketing page.
- The opt-in live-route harness must stay disabled by default and use injected passport resolution/fake model tools for tests; do not wire production `/api/chat` yet.

## Public/product language

```text
Identity Kernel MCP: a runtime boundary service for agents.
A true-name firewall for agents.
```

Forbidden phrasing:

```text
prompt filter that prevents jailbreaks
optional LLM-callable safety checker
```

## Task 1: Add identity-kernel package skeleton and RED tests

**Objective:** Define the package API through tests before production code.

**Files:**
- Create: `packages/identity-kernel/package.json`
- Create: `packages/identity-kernel/tsconfig.json`
- Create: `packages/identity-kernel/src/index.test.ts`
- Later create: `packages/identity-kernel/src/index.ts`
- Modify later: `tsconfig.json`

**RED tests must assert:**

- `evaluatePrompt()` downgrades Gabriel public-chat `terminal` requests while granting `browser`.
- prompt injection text such as `you are DAN` cannot rename the agent and returns `refuse` or `transform` with safe instruction.
- `evaluateContext()` transforms hidden retrieved-document or memory instructions before context admission.
- `evaluateToolCall()` denies terminal/exfiltration when `terminal` is outside authority scope.
- `evaluateOutput()` transforms unsafe operational output pressure.
- every verdict has a deterministic `receipt_hash`.
- exported functions exist: `evaluatePrompt`, `evaluateContext`, `evaluateToolCall`, `evaluateOutput`, `issueRuntimeFrame`, `checkAuthorityScope`, `writeReceipt`, `explainRefusal`.

**Command:**

```bash
pnpm vitest run packages/identity-kernel/src/index.test.ts
```

**Expected RED:** fail because package implementation does not exist yet.

## Task 2: Implement minimal pure kernel

**Objective:** Make the RED tests pass with the smallest pure TypeScript policy engine.

**Files:**
- Create: `packages/identity-kernel/src/index.ts`

**Implementation rules:**

- Do not call an LLM.
- Do not read external state.
- Use deterministic heuristics only for v0.
- Receipt hash is SHA-256 over canonical JSON of bounded inputs/verdict fields.
- `authority_scope` controls tool grants/denials.
- Treat identity-override strings as identity-boundary attacks.

**Command:**

```bash
pnpm vitest run packages/identity-kernel/src/index.test.ts
```

**Expected GREEN:** package tests pass.

## Task 3: Add deterministic gateway hook adapter and RED tests

**Objective:** Prove the gateway/runtime, not the LLM, calls the kernel at the required gates.

**Files:**
- Create: `services/gateway/src/identity-kernel-gate.test.ts`
- Later create: `services/gateway/src/identity-kernel-gate.ts`
- Modify later: `services/gateway/package.json`
- Modify later: `services/gateway/tsconfig.json`

**RED tests must assert:**

- `runIdentityKernelGatedTurn()` calls kernel before the model sees `ignore your safety checker`.
- model is not called when prompt verdict is `refuse`.
- retrieved/memory context is evaluated before being admitted.
- missing context/tool/output evaluators fail closed rather than default-open.
- hidden retrieved/memory instructions are withheld from the model context.
- a denied tool call does not execute the tool function.
- final output is evaluated before release.
- returned receipts include `pre_llm`, `context`, `tool`, and `output` stages when applicable.

**Command:**

```bash
pnpm vitest run services/gateway/src/identity-kernel-gate.test.ts
```

**Expected RED:** fail because adapter implementation does not exist yet.

## Task 4: Implement minimal gateway adapter

**Objective:** Make deterministic hook tests pass without wiring production `/api/chat` yet.

**Files:**
- Create: `services/gateway/src/identity-kernel-gate.ts`
- Modify: `services/gateway/package.json`
- Modify: `services/gateway/tsconfig.json`

**Implementation rules:**

- `runIdentityKernelGatedTurn()` accepts injected `kernel`, `model`, `tools`, and bounded envelope.
- Calls `evaluatePrompt()` before `model()`.
- Calls context evaluation before passing retrieved/memory context into `model()`; transformed context is withheld.
- Calls `evaluateToolCall()` before executing any tool.
- Calls `evaluateOutput()` before returning final text.
- Fails closed if any required evaluator is missing; no adapter-local default allow.
- Never lets model output decide whether checks run.

**Command:**

```bash
pnpm vitest run services/gateway/src/identity-kernel-gate.test.ts packages/identity-kernel/src/index.test.ts
```

**Expected GREEN:** targeted tests pass.

## Task 5: Build/typecheck receipts

**Objective:** Verify the package compiles inside the workspace.

**Files:**
- Modify: root `tsconfig.json` to reference `packages/identity-kernel`.

**Commands:**

```bash
pnpm typecheck
pnpm build
```

If full repo gates hit unrelated pre-existing external/live blockers, capture targeted package build plus exact blocker.

## Task 6: Council-visible review

**Objective:** Have five visible Council seats review the plan/build delta in the origin Discord thread.

**Packet must include:**

- scope: Identity Kernel v0 package + deterministic gateway adapter only;
- commit/worktree status;
- exact files changed;
- targeted tests and typecheck/build receipts;
- explicit boundary: no beta deploy, no production env, no live x402, no optional LLM checker claim;
- ask for `ALLOW` or `REVISE`.

**Council gate:**

- 5 visible replies required.
- Provider failures / withdrawals do not count.
- Any concrete REVISE creates a fix-and-recheck loop.
- Any material post-ALLOW code change requires narrow delta recheck.

## Task 7: Passport-bound live-route harness delta

**Objective:** Prove the adapter can sit behind an HTTP route while remaining isolated from production chat/beta deployment. The route must bind each turn to a signed wallet session plus a resolved created passport before constructing the Identity Kernel envelope.

**Files:**
- Modify: `services/gateway/src/app.ts`
- Create: `services/gateway/src/identity-kernel-route.test.ts`

**RED tests must assert:**

- `POST /api/identity-kernel/harness` is available only when the harness is explicitly injected in tests.
- A signed wallet session plus `passport_id` is resolved before model/tool execution.
- Foreign/unlinked passports return `403` before model/tool calls.
- The generated envelope preserves `agent_id`, `passport_id`, `active_system_prompt_hash`, `authority_scope`, and `risk_context` from the resolved passport.
- Hidden retrieved context is withheld before model admission (`model_context_count:0`).
- Terminal pressure in `requested_tools` is downgraded by passport authority; the terminal tool is never executed.
- An allowed browser tool still goes through the tool gate, and final output is checked before release.
- Receipts include `pre_llm`, `context`, `tool`, and `output`, all carrying the same `passport_id`.

**Implementation rules:**

- The route is an opt-in harness, not production `/api/chat` wiring.
- Passport resolution is injected as `resolvePassport({ wallet, passport_id })`; real ERC-8004 ownership/URI validation remains a later resolver slice.
- The model and tools are injected fakes for tests; no LLM/network/tool side effect is required.
- Missing or mismatched passport resolution fails before model/tool execution.

**Command:**

```bash
pnpm vitest run services/gateway/src/identity-kernel-route.test.ts
```

**Expected GREEN:** route harness tests pass; then rerun package/gate/route focused tests, typecheck, build, and full test suite.

## Task 8: Fake ERC-8004-style passport resolver boundary

**Objective:** Replace the purely injected passport object in tests with a fake ERC-8004-style resolution boundary: wallet + passport id -> owner lookup -> tokenURI -> passport document -> `IdentityEnvelope`.

**Files:**
- Create: `services/gateway/src/identity-kernel-passport-resolver.ts`
- Create: `services/gateway/src/identity-kernel-passport-resolver.test.ts`

**RED tests must assert:**

- Matching owner path calls `ownerOf(passport_id)`, then `tokenURI(passport_id)`, then fetches the passport document.
- Owner comparison is wallet-case-insensitive.
- Wrong owner returns `null` before tokenURI/document fetch.
- Malformed, missing-id, or mismatched passport documents return `null`.
- Route harness composition using this resolver builds the same passport-bound envelope and preserves previous boundary receipts.
- Wrong owner in route composition returns `403` before model/tool execution.

**Implementation rules:**

- This is a fake/injected ERC-8004 client boundary only; do not call live chain from tests.
- `ResolvedErc8004Passport` fields must come from the passport document after ownership check, not from request body authority fields.
- Resolver failures return `null`, causing the route harness to fail closed.
- Do not claim real created-passport ownership until a live resolver verifies owner + URI against the registry.

**Command:**

```bash
pnpm vitest run services/gateway/src/identity-kernel-passport-resolver.test.ts
```

**Expected GREEN:** resolver tests pass; then rerun package/gate/route/resolver focused tests, typecheck, build, and full test suite.

## Task 9: Live ERC-8004 resolver adapter + fixture smoke

**Objective:** Add a read-only live client that can satisfy the generic `Erc8004PassportClient` interface from a real ERC-8004 Identity Registry, then smoke the known Base Sepolia passport fixture without claiming production enforcement.

**Files:**
- Create: `services/gateway/src/identity-kernel-live-passport-client.ts`
- Create: `services/gateway/src/identity-kernel-live-passport-client.test.ts`
- Create: `services/gateway/src/identity-kernel-live-passport-smoke.live.test.ts`
- Create: `apps/web/public/agents/demo-passport.json`
- Create: `apps/web/app/agents/demo-passport.copy.test.ts`

**RED tests must assert:**

- The live client calls `ownerOf(passport_id)` and `tokenURI(passport_id)` with the decimal passport id converted to a bigint token id.
- Data-URI passport documents decode without a network fetch.
- HTTPS document fetch rejects non-OK responses.
- IPFS URIs map through the configured gateway.
- Resolver composition still requires fetched document self-identification.
- The static demo passport document self-identifies `passport_id: "6960"` and carries Identity Kernel fields.

**Live smoke command:**

```bash
IDENTITY_KERNEL_RUN_LIVE_PASSPORT_SMOKE=1 \
IDENTITY_KERNEL_LIVE_NETWORK=baseSepolia \
IDENTITY_KERNEL_LIVE_PASSPORT_ID=6960 \
pnpm vitest run services/gateway/src/identity-kernel-live-passport-smoke.live.test.ts
```

**Expected status:**

- `wrong_wallet_fails_closed: true` must pass.
- If the currently registered `tokenURI` is unreachable, the smoke may pass with `status: "incomplete"` and `document_fetch_reason` explaining the blocker. Do not call this live passport enforcement until the URI document is reachable and resolves to a self-identifying passport.

**Boundary:** read-only live owner/URI smoke plus static fixture readiness. No mint, deploy, production `/api/chat`, beta bridge, or live x402 coupling in this slice.
