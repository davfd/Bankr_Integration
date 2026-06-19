# Repro Lab Platform Plan Council Synthesis

Run token: `REPRO_LAB_PLATFORM_PLAN_AUDIT_20260614T032127Z`

Plan artifact reviewed:

```text
/home/exor/leonardo-platform/docs/plans/2026-06-14-repro-lab-platform-plan.md
initial sha256 ba12a73d1e45a4de2e0ea313467e88b2775b95849c7fe32d65bc2a4df8125ed7
```

## Seat results

| Seat | Status | Required change |
|---|---|---|
| Philo | READY_WITH_CHANGES | Make private seed body a public-MVP prohibition; add stronger receipt witnesses; keep real full run blocked/request-only until job queue/auditor gate exists. |
| Kallimachos | READY_WITH_CHANGES | Bind eval runs to session/wallet; add redaction tests proving no raw prompt/completion/private seed/private path crosses UI/history/report/receipt/logs. |
| Sextus Empiricus | CONTESTED | Reusing `ToolShell` creates a history side-channel unless Repro Lab history stores only bounded metadata/hashes or the history rail is replaced/disabled. |
| Humboldt | READY_WITH_CHANGES | Require `x-leo-session` binding, stronger receipt schema, and demote real harness bridge to phase 2 or blocked stub. |
| Archimedes | READY_WITH_CHANGES | Specify canonical `receipt_sha256` inputs, freeze HarmBench manifest hash once at registry startup, and decide mock-only smoke for MVP vs polling real harness. |

## Synthesis

The plan was **not done as originally drafted**. The shape was correct — platform app, not landing site; redacted receipt surface, not harmful-prompt playground — but the Council found four material gaps:

1. **History side-channel:** `ToolShell` renders `HistoryRail` entries verbatim. Repro Lab must append only bounded metadata/hashes or use a modified/no history rail.
2. **Access control:** run/report/receipt routes must require `x-leo-session` and bind runs to wallet/session; wallet A must not fetch wallet B artifacts.
3. **Receipt strength:** reproduction claims require seed hash/bytes/system-role proof, manifest hash, harness commit/diff, provider/resolved model route, run config, command/log/result/redaction hashes, and canonical receipt hashing.
4. **Real harness boundary:** MVP must be deterministic mock/smoke only; real HarmBench adapter is phase 2 / blocked stub until job queue, operator approval, auditor gate, and private→redacted pipeline exist.

## Action taken

The plan was amended to incorporate all Council-required changes, and the implementation carried the same gates:

- private seed body text is now prohibited from public/user UI, receipts, reports, history, logs, and chat;
- public schemas ban `prompt`, `completion`, `raw_*`, `seed_body`, private paths, and raw HarmBench CSV row text;
- run/report/receipt endpoints are session-bound and wallet-isolated;
- Repro Lab history contract stores only `run_id`, `recipe_id`, mode/status, and hashes/metrics summary;
- the generic `/api/history` write route rejects `kind: "repro"`, so Repro history is system-written only;
- receipt schema now includes the independent witness fields named by the Council;
- `receipt_sha256` is defined over canonical sorted JSON;
- `manifest_hash` uses the HarmBench CSV byte hash when the harness root is present, otherwise labels itself as a synthetic MVP witness rather than overclaiming;
- MVP smoke is synchronous mock-only;
- real harness adapter is demoted to phase 2 blocked stub.

## Build gate

With the amended plan, the implementation gate is open for **MVP only**:

```text
BUILD_ALLOWED: gateway eval tests + deterministic mock smoke + /tools/repro UI + redacted receipts
BUILD_BLOCKED: real HarmBench execution, raw output browsing, public seed body display, full 400-case run
```

## Refusal conditions carried forward

Stop and re-Council if implementation does any of the following:

- exposes raw HarmBench prompt/completion/content in UI, history, logs, receipts, reports, or chat;
- exposes private seed body text in public/user UI;
- lets full 400-case runs execute without explicit operator approval, job queue, auditor gate, and configured harness path;
- edits `/home/exor/leonardo-site` instead of `/home/exor/leonardo-platform`;
- claims model safety, truth, Council verdict, canon status, or generalized Gemma proof.
