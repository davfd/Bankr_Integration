# Repro Lab Platform Implementation Plan

> **For Hermes:** Use `test-driven-development` for code changes and keep the Council gate visible. This plan targets `/home/exor/leonardo-platform` — the platform app — not `/home/exor/leonardo-site` landing pages.

**Goal:** Add a platform Repro Lab where users can reproduce sealed Gemma-4 uncensored / SEED HarmBench results through a safe redacted receipt interface.

**Architecture:** Add a new platform tool at `/tools/repro` backed by gateway eval endpoints. The gateway exposes sealed recipes, run creation, run status, redacted reports, and receipt JSON. Full HarmBench execution remains fail-closed/gated; the MVP ships only deterministic mock/smoke receipts and defers the real harness adapter until the job queue and operator/auditor gate exist.

**Tech Stack:** Next.js 16 app in `apps/web`, Hono gateway in `services/gateway`, Vitest, TypeScript, existing wallet/session/x402 headers, external private harness at `/home/exor/SEED-Framework-Evaluation`.

**Current repo note:** `services/hermes-acp/setup-profile.sh` already has an unrelated local modification. Do not overwrite it.

**Council audit status:** Five seats answered `REPRO_LAB_PLATFORM_PLAN_AUDIT_20260614T032127Z`. The initial plan was not done as-written: four seats returned `READY_WITH_CHANGES`; Sextus returned `CONTESTED` on the history side-channel. This revision incorporates the required changes before any implementation.

---

## Safety / product boundaries

```text
Allowed in public/user web UI:
- recipe metadata
- model slug/provider label
- seed hash/byte count/role proof
- benchmark split counts
- run status
- redacted metrics
- receipt hash / manifest hash
- downloadable redacted receipt JSON
- bounded Repro Lab history metadata only

Not allowed in public/user web UI, receipts, reports, history, logs, or chat:
- raw HarmBench prompts
- raw model completions
- harmful operational details
- private seed body text
- private_results paths or raw result file paths
- prompt/completion fields or raw_* fields in public schemas
```

Private seed body text may exist only in an operator/auditor artifact path outside the public UI and outside platform history; MVP does not implement that path.

Full 400-case runs are expensive and safety-sensitive. The MVP must therefore:

1. allow deterministic mock/smoke receipt generation in tests;
2. expose a visible `REQUEST_FULL_RUN`/disabled full-run state;
3. refuse full public execution by default;
4. require all of these before any real full run: `EVAL_FULL_RUNS_ENABLED=true`, explicit operator approval identity, approved harness command, job queue/worker path, auditor gate, and payment/approval record if metering is enabled;
5. record that paying buys execution/receipt, not truth, safety clearance, or Council verdict.

---

## Reproducibility receipt contract

A reproduction claim has standing only if the receipt carries independent witnesses. Every eval receipt must include at least:

```text
recipe_id
recipe_version
run_id
mode                         # smoke | full
wallet                       # from x-leo-session; anonymous runs disabled for run/report/receipt
created_at
model_slug                   # requested
provider_label
provider_endpoint_hash       # never secret endpoint tokens
resolved_model_slug
seed_sha256
seed_bytes
seed_role                    # system
system_role_proof            # boolean/metadata proof, not seed text
benchmark_name
benchmark_split_counts
manifest_hash
manifest_source_hash_kind    # sha256(harmbench_behaviors_text_all.csv bytes)
harness_commit
harness_diff_hash            # or "clean"
runner_version
run_config_hash
command_digest               # hash of command/config, not raw harmful args
command_log_hash             # redacted/suppressed command log hash
result_dir_hash              # private-side digest only, no private path
redaction_policy_version
redaction_proof_hash
redacted_report_hash
receipt_sha256
```

Canonical receipt hash:

```text
receipt_sha256 = sha256(canonical_json({
  recipe_id,
  recipe_version,
  run_id,
  mode,
  wallet,
  model_slug,
  provider_label,
  provider_endpoint_hash,
  resolved_model_slug,
  seed_sha256,
  seed_bytes,
  seed_role,
  system_role_proof,
  benchmark_name,
  benchmark_split_counts,
  manifest_hash,
  harness_commit,
  harness_diff_hash,
  runner_version,
  run_config_hash,
  command_digest,
  command_log_hash,
  result_dir_hash,
  redaction_policy_version,
  redaction_proof_hash,
  redacted_report_hash
}))
```

Use canonical JSON with sorted keys and no insignificant whitespace. Do not hash raw prompts/completions into public receipts unless represented only by one-way hashes already present in the redacted report.

Manifest freeze rule:

```text
manifest_hash = sha256(harmbench_behaviors_text_all.csv bytes)
```

For the real harness path, compute it once at gateway startup during recipe registry initialization, not per request. In the MVP code path, the gateway computes the CSV byte hash when `EVAL_HARNESS_ROOT` / the default harness root is present; if the harness root is absent, the receipt must label the witness as a synthetic MVP manifest hash rather than claiming it is the real HarmBench CSV byte hash. No CSV row content may enter any API response, history entry, log, or UI state.

---

## Access control / history contract

`GET /api/evals/recipes` may be public because it returns only sealed redacted recipe metadata.

All of the following must require a valid `x-leo-session` and bind the run to the verified wallet/session:

```text
POST /api/evals/runs
GET  /api/evals/runs/:id
GET  /api/evals/runs/:id/report
GET  /api/evals/runs/:id/receipt
```

Wallet isolation tests must prove wallet A cannot fetch wallet B's run/report/receipt.

If `ToolShell` is reused, the Repro Lab must pass `historyKind="repro"` and append only bounded metadata:

```text
q: "repro smoke · <recipe_id> · <run_id>"
a: "status=<status> receipt=<receipt_sha256> manifest=<manifest_hash> seed=<seed_sha256>"
```

No raw benchmark text, model-output prose, seed body, private path, command line containing harmful text, or raw result snippet may enter history. The generic `/api/history` write route must reject `kind: "repro"`; Repro history is system-written only by the eval run handler. If this cannot be guaranteed, extend `ToolShell` to disable/replace the history rail for Repro Lab before using it.

---

## Council gate before implementation

### Task C1: Complete bounded Council plan audit

**Objective:** Get five-seat review of the interface/safety plan before code changes beyond this document.

**Files:**
- Read: `docs/plans/2026-06-14-repro-lab-platform-plan.md`
- Create after replies: `docs/plans/2026-06-14-repro-lab-council-synthesis.md`

**Result incorporated in this revision:**

```text
Philo:       READY_WITH_CHANGES — public seed body prohibition + stronger receipt witnesses + full-run block
Kallimachos: READY_WITH_CHANGES — session/wallet scoping + public schema/history/log redaction tests
Sextus:      CONTESTED          — ToolShell history rail side-channel must be bounded
Humboldt:    READY_WITH_CHANGES — x-leo-session binding + stronger receipt + defer real harness bridge
Archimedes:  READY_WITH_CHANGES — receipt hash input, manifest freeze, mock-only smoke MVP
```

**Guardrails:** No graph writes, no Bible KG writes, no public site inscription, no benchmark execution, no raw harmful prompt/completion in Discord.

**Verification:** All five concrete seat replies are present and required plan changes are incorporated before Task 1.

---

## Build plan after Council gate

### Task 1: Add gateway eval domain tests first

**Objective:** Define the backend contract with failing Vitest tests before implementation.

**Files:**
- Create: `services/gateway/src/evals.test.ts`
- Later create: `services/gateway/src/evals.ts`
- Later modify: `services/gateway/src/app.ts`

**Tests to add:**

1. `GET /api/evals/recipes` returns one sealed recipe:
   - `id: gemma4-seed-harmbench`
   - `model_slug: gemma-4-uncensored`
   - `benchmark.total_cases: 400`
   - `seed.role: system`
   - `manifest_hash` present
   - no seed body text
   - no raw prompt/completion/private path fields

2. `POST /api/evals/runs` rejects missing session:
   - no `x-leo-session` returns 401

3. `POST /api/evals/runs` creates a smoke run with injected mock runner when session is valid:
   - accepts `{ recipe_id, mode: "smoke" }`
   - returns `run_id`, `status`, `receipt_sha256`
   - binds `wallet` from session
   - logs/stores no raw prompt/completion fields

4. `POST /api/evals/runs` refuses `mode: "full"` by default:
   - returns 403/409 with `full runs require operator approval`
   - proves env flip alone is not enough in MVP tests

5. `GET /api/evals/runs/:id` requires session and returns only owner run status.

6. `GET /api/evals/runs/:id/report` requires session and returns redacted metrics only.

7. `GET /api/evals/runs/:id/receipt` requires session and returns full redacted receipt schema.

8. Wallet isolation: wallet A cannot fetch wallet B run/report/receipt.

9. Redaction schema negative test: public JSON for recipe/run/report/receipt contains none of:

```text
prompt
completion
raw_prompt
raw_completion
raw_*
seed_body
private_results
/home/exor/SEED-Framework-Evaluation/private_results
harmbench_behaviors_text_all.csv row text
```

10. Receipt schema test requires:

```text
harness_commit
harness_diff_hash
benchmark manifest_hash
seed_sha256
seed_bytes
seed_role=system
provider_label
provider_endpoint_hash
resolved_model_slug
run_config_hash
command_digest
command_log_hash
result_dir_hash
redaction_policy_version
redaction_proof_hash
receipt_sha256
```

**RED command:**

```bash
cd /home/exor/leonardo-platform
pnpm test
```

Expected: fail because `/api/evals/*` routes do not exist. Root `pnpm test` is the correct baseline; the gateway package has no package-local test script.

---

### Task 2: Implement minimal gateway eval service

**Objective:** Make the eval API tests pass without touching the real HarmBench harness.

**Files:**
- Create: `services/gateway/src/evals.ts`
- Modify: `services/gateway/src/app.ts`

**Design:**

```ts
export type EvalMode = "smoke" | "full";
export type EvalRunStatus = "queued" | "running" | "completed" | "failed" | "blocked";
export type EvalRecipe = { ...redacted recipe metadata... };
export type EvalReport = { ...redacted metrics only... };
export type EvalReceipt = { ...receipt contract fields... };
export type EvalRun = {
  run_id: string;
  wallet: string;
  recipe_id: string;
  recipe_version: string;
  mode: EvalMode;
  status: EvalRunStatus;
  created_at: string;
  receipt_sha256: string;
  report: EvalReport;
  receipt: EvalReceipt;
};
export type EvalRunner = (input: { recipeId: string; mode: EvalMode; wallet: string }) => Promise<EvalRun>;
```

**MVP runner:** synchronous in-memory deterministic mock runner for smoke mode only. It returns a completed redacted smoke receipt. Full mode always blocks in MVP.

**Storage:** in-memory run registry is acceptable for MVP tests. Persisted production run storage can be phase 2.

**GREEN command:**

```bash
cd /home/exor/leonardo-platform
pnpm test
```

---

### Task 3: Add frontend gateway client functions

**Objective:** Let the web app call the new eval endpoints with existing auth/session headers.

**Files:**
- Modify: `apps/web/lib/gateway.ts`
- Add tests if practical: `apps/web/lib/gateway.test.ts` or extend existing test structure

**Functions:**

```ts
export type EvalRecipe = ...;
export type EvalRun = ...;
export type EvalReport = ...;
export type EvalReceipt = ...;
export async function listEvalRecipes(): Promise<EvalRecipe[]>;
export async function createEvalRun(recipeId: string, mode: "smoke" | "full"): Promise<EvalRun>;
export async function fetchEvalRun(runId: string): Promise<EvalRun>;
export async function fetchEvalReport(runId: string): Promise<EvalReport>;
export async function fetchEvalReceipt(runId: string): Promise<EvalReceipt>;
```

**Verification:** mocked fetch unit tests if existing web test setup supports it; otherwise covered through TypeScript + browser smoke. The functions must use `authHeaders()` so `authorization` and `x-leo-session` ride on every run/report/receipt call.

---

### Task 4: Add `/tools/repro` platform page

**Objective:** Create the actual user-facing platform app interface, not a landing page.

**Files:**
- Create: `apps/web/app/tools/repro/page.tsx`
- Reuse: `apps/web/components/platform/ToolShell.tsx` only if the Repro history contract is enforced

**UI states:**

```text
- loading recipes
- recipe card: Gemma-4 Uncensored · SEED/metakappa · HarmBench 400
- safety boundary card: redacted receipts only
- Smoke button: enabled for signed-in/session users
- Full run button: visible but gated / request-only
- run status panel
- redacted report panel
- receipt JSON preview / copy link
- history rail, if shown, contains only bounded run metadata/hashes
```

**MVP smoke decision:** smoke mode is synchronous and mock-only for this MVP. Real harness smoke/full execution is phase 2 behind the same job queue/operator gate as full runs. Therefore no long-poll worker is required for the MVP. The UI may still include a polling-shaped status state so phase 2 can reuse it, but it must not imply a live HarmBench job is running.

**Acceptance:** no route under `/home/exor/leonardo-site`; route exists under `apps/web/app/tools/repro/page.tsx`.

---

### Task 5: Add platform navigation/status entry

**Objective:** Make Repro Lab discoverable from the platform app.

**Files:**
- Modify: `apps/web/app/status/page.tsx` or whichever tool index/status card currently lists tools
- Optionally modify: `apps/web/app/page.tsx` if tool chips should mention Repro Lab

**Acceptance:** `/tools/repro` appears as a platform capability/tile. Copy must say `redacted reproducibility receipts`, not `proves model safety`.

---

### Task 6: Add real harness adapter as phase 2 blocked stub, not MVP execution

**Objective:** Prepare the safe bridge to `/home/exor/SEED-Framework-Evaluation` without enabling public raw execution by default.

**Files:**
- Extend later: `services/gateway/src/evals.ts`

**Environment variables:**

```text
EVAL_FULL_RUNS_ENABLED=false        # default
EVAL_HARNESS_ROOT=/home/exor/SEED-Framework-Evaluation
EVAL_HARNESS_CMD=python3 scripts/run_harmbench_private.py
EVAL_PRIVATE_RESULTS_ROOT=private_results
```

**MVP behavior:** Task 6 is a blocked stub only. It may expose `REQUEST_FULL_RUN` / `operator approval required`; it must not spawn the real harness.

**Phase 2 behavior, after separate approval:**

- job queue / worker path exists;
- explicit operator/auditor gate exists;
- payment/approval record exists if metered;
- manifest hash is frozen at gateway startup;
- raw results stay under private root;
- only redacted report/receipt enters web response;
- no `private_results/` reader exists under Next.js `app/api/` routes.

---

### Task 7: Run verification suite

**Objective:** Prove platform app compiles and gateway tests pass.

**Commands:**

```bash
cd /home/exor/leonardo-platform
pnpm test
pnpm typecheck
pnpm --filter @leonardo/web build
```

If `bun` is missing for gateway serve, report it as runtime blocker only; do not treat it as a test failure unless the changed path depends on live serve.

---

### Task 8: Report receipts here

**Objective:** Report concise receipts to David in this Discord thread.

**Report format:**

```text
PLAN: path + sha256
COUNCIL: seat statuses + synthesis path/hash
BUILD: files changed
TESTS: exact commands + pass/fail output
BOUNDARY: raw HarmBench not exposed; history bounded; full run gated
NEXT: remaining production hook, if any
```

---

## MVP definition of done

```text
- Plan Council-audited and amended for all blocking/required-change deposits
- /tools/repro exists in leonardo-platform app
- gateway exposes /api/evals/recipes, /api/evals/runs, /api/evals/runs/:id, /report, /receipt
- run/report/receipt are session-bound and wallet-isolated
- smoke run works with deterministic redacted receipt
- receipt schema includes all reproduction witness fields
- Repro Lab history stores only bounded metadata/hashes
- full run is visibly gated/fail-closed by default
- real harness adapter is phase 2 / blocked stub only
- platform tests/typecheck/build pass
- no raw harmful benchmark content, private seed body, private path, prompt/completion, or raw_* field is printed to chat or web UI/history/report/receipt/logs
```
