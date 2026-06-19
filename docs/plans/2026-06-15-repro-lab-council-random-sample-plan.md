# Repro Lab Council Random-Sample Harness Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Convert Repro Lab from smoke-only receipts into a David-only, Council-visible random-sample HarmBench reproduction lane that runs Gemma-4 Uncensored baseline and SEED conditions without exposing raw prompts, completions, seed body, or private result paths.

**Architecture:** Keep `/tools/repro` as the public evidence surface. Add a new `sample` eval mode that selects hashed HarmBench case refs at random, enforces a wallet allowlist, runs only a bounded subset, and emits redacted metrics/receipts plus a Council audit packet. Keep `full` mode fail-closed.

**Tech Stack:** Hono gateway, Vitest, Next.js client page, existing SEED private runner/redactor under `/home/exor/SEED-Framework-Evaluation`.

---

## Authority and safety boundaries

- Full 400-case benchmark stays blocked.
- Random sample size is capped by `REPRO_LAB_MAX_SAMPLE_CASES` (default small) and must be less than 400.
- Sample execution requires a signed wallet session and `REPRO_LAB_ALLOWED_WALLETS` / `EVAL_ALLOWED_WALLETS` / `ALLOWED_WALLETS`; no allowlist means fail-closed.
- Current allowed user is David only via env-configured wallet allowlist.
- Public payloads may include hashed case refs, hashes, metrics, and status only.
- Public payloads must not include raw HarmBench prompts, completions, seed body, private raw dirs, private redaction dirs, command stdout/stderr, or API keys.
- Council receives protocol/result audit packets; no automatic public dispatch from the UI.

## Task 1: Extend eval model and tests for random samples

**Objective:** Add test-first coverage for `mode: "sample"`.

**Files:**
- Modify: `services/gateway/src/evals.test.ts`
- Modify later: `services/gateway/src/evals.ts`

**Tests to add:**
1. David-only wallet gate: allowed wallet can request sample; another signed wallet gets 403 and executor is not called.
2. Sample run selects fewer than 400 hashed refs, binds baseline+SEED Gemma-4 Uncensored, and returns only redacted public fields.
3. `sample_size >= 400` and over max are rejected.
4. Sample Council packet contains protocol/result audit tokens and says this is not full benchmark reproduction.

**Verification command:**

```bash
cd /home/exor/leonardo-platform
env -u GATEWAY_TOKEN pnpm test -- services/gateway/src/evals.test.ts
```

Expected RED before implementation: compile/runtime failures for missing `sample` mode/service options.

## Task 2: Implement backend sample mode

**Objective:** Implement bounded random sample execution contract.

**Files:**
- Modify: `services/gateway/src/evals.ts`
- Modify: `services/gateway/src/app.ts`

**Implementation notes:**
- Add `EvalMode = "smoke" | "sample" | "full"`.
- Add `EvalSamplePlan` with `sample_size`, `sample_seed`, `splits`, `case_refs`, `selection_hash`, `conditions: ["baseline", "seed"]`.
- Add allowlist helper using `REPRO_LAB_ALLOWED_WALLETS || EVAL_ALLOWED_WALLETS || ALLOWED_WALLETS`.
- Add sample-size guard: integer, 1..max, max < full benchmark total.
- Add deterministic random selection by sorting hashed refs with `sha256(sample_seed + ref)`.
- Add injectable `sampleExecutor` for tests.
- Default executor prepares a private `case_refs.json`/text file and runs the existing SEED private runner/redactor only when explicitly enabled.
- Never put raw stdout/stderr in API response; only hashes.

**Verification:** targeted eval tests pass.

## Task 3: Extend web client and Repro Lab UI

**Objective:** Let David run a bounded random sample from the UI and see exactly what it proves.

**Files:**
- Modify: `apps/web/lib/gateway.ts`
- Modify: `apps/web/lib/gateway-evals.test.ts`
- Modify: `apps/web/app/tools/repro/page.tsx`
- Modify: `apps/web/app/status/page.tsx`

**Implementation notes:**
- Add `EvalMode "sample"` and sample request fields to `createEvalRun`.
- Add UI controls for sample size/seed/splits.
- Add a button `Run random sample` separate from `Run smoke receipt`.
- Copy must say: random sample runs baseline+SEED Gemma-4 Uncensored; it still does not reproduce full 400-case benchmark.
- Show sample refs only as hashed refs and concise metrics.

**Verification:** client tests, typecheck, build.

## Task 4: Verify local behavior and redaction

**Objective:** Prove the endpoint and UI are honest and safe.

**Commands:**

```bash
cd /home/exor/leonardo-platform
env -u GATEWAY_TOKEN -u NEXT_PUBLIC_GATEWAY_TOKEN -u METER -u PORT pnpm test
env -u GATEWAY_TOKEN -u NEXT_PUBLIC_GATEWAY_TOKEN -u METER -u PORT pnpm typecheck
env -u GATEWAY_TOKEN -u NEXT_PUBLIC_GATEWAY_TOKEN -u METER -u PORT pnpm --filter @leonardo/web build
```

**Manual/API checks:**
- unsigned sample request → 401
- signed disallowed wallet sample request → 403
- signed allowed wallet sample request → completed/receipt with `mode=sample`, `conditions=[baseline, seed]`, `sample_size < 400`
- full request → 403
- Council packet → redacted, contains sample audit tokens, no raw/private text

## Task 5: Independent review

**Objective:** Fail-closed review before claiming done.

Use `requesting-code-review`:
- static scan changed diff for secrets/shell injection/eval/unsafe deserialization
- verify no raw HarmBench prompts/completions/seed/private paths in public payloads
- independent reviewer checks logic and safety gates

## Reporting shape to David

```text
Done / not done:
- Full 400-case reproduction: still blocked.
- Random sample reproduction lane: implemented.
- Conditions: Gemma-4 Uncensored baseline + SEED system prompt.
- Gate: signed session + David wallet allowlist.
- Council: redacted packet generated, no auto-dispatch.
- Verification: tests/typecheck/build/browser/API receipts.
```
