import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createGatewayApp } from "./app";
import { createEvalService, type EvalSampleExecutionInput, type EvalSampleExecutionResult } from "./evals";

const SECRET = "repro-lab-session-secret";
const WALLET_A = "0xabc1000000000000000000000000000000000001";
const WALLET_B = "0xabc2000000000000000000000000000000000002";

function mintToken(wallet: string, expMs = Date.now() + 60_000): string {
  const normalized = wallet.toLowerCase();
  const payload = `leo2.${normalized}.${expMs}.holder`;
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function session(wallet = WALLET_A): Record<string, string> {
  return { "x-leo-session": mintToken(wallet) };
}

function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "content-type": "application/json", ...extra };
}

async function createSmokeRun(app: ReturnType<typeof createGatewayApp>, wallet = WALLET_A): Promise<Record<string, unknown>> {
  const res = await app.request("/api/evals/runs", {
    method: "POST",
    headers: jsonHeaders(session(wallet)),
    body: JSON.stringify({ recipe_id: "gemma4-seed-harmbench", mode: "smoke" }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.ok).toBe(true);
  return body;
}

function walkKeysAndValues(value: unknown, keys: string[] = [], values: string[] = []): { keys: string[]; values: string[] } {
  if (Array.isArray(value)) {
    for (const item of value) walkKeysAndValues(item, keys, values);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      keys.push(k);
      walkKeysAndValues(v, keys, values);
    }
  } else if (typeof value === "string") {
    values.push(value);
  }
  return { keys, values };
}

function expectPublicPayloadRedacted(payload: unknown): void {
  const { keys, values } = walkKeysAndValues(payload);
  expect(keys).not.toContain("prompt");
  expect(keys).not.toContain("completion");
  expect(keys).not.toContain("seed_body");
  expect(keys.some((k) => k.startsWith("raw_"))).toBe(false);
  const joined = values.join("\n").toLowerCase();
  expect(joined).not.toContain("private_results");
  expect(joined).not.toContain("/home/exor/seed-framework-evaluation/private_results");
  expect(joined).not.toContain("raw_harmbench_prompt_sentinel");
  expect(joined).not.toContain("raw_model_completion_sentinel");
}

const SAMPLE_CASE_CATALOG = [
  { split: "standard" as const, case_ref: "standard:111111111111" },
  { split: "standard" as const, case_ref: "standard:222222222222" },
  { split: "standard" as const, case_ref: "standard:333333333333" },
  { split: "contextual" as const, case_ref: "contextual:aaaaaaaaaaaa" },
  { split: "contextual" as const, case_ref: "contextual:bbbbbbbbbbbb" },
  { split: "copyright" as const, case_ref: "copyright:cccccccccccc" },
  { split: "copyright" as const, case_ref: "copyright:dddddddddddd" },
];

function fakeCompletedSampleExecutor(
  seen: EvalSampleExecutionInput[] = [],
): (input: EvalSampleExecutionInput) => Promise<EvalSampleExecutionResult> {
  return async (input: EvalSampleExecutionInput): Promise<EvalSampleExecutionResult> => {
    seen.push(input);
    return {
      status: "completed",
      metrics: {
        cases_total: input.sample.case_refs.length,
        baseline_refusals: 0,
        seed_refusals: input.sample.case_refs.length,
        baseline_asr: 1,
        seed_asr: 0,
        marker_nonrefusal_count: 0,
      },
      evidence: input.sample.case_refs.map((caseRef, index) => ({
        case_ref: caseRef,
        split: caseRef.split(":")[0],
        prompt: `RAW_HARMBENCH_PROMPT_SENTINEL ${index}`,
        baseline_output: `RAW_BASELINE_HARMFUL_OUTPUT_SENTINEL ${index}`,
        baseline_refused: false,
        baseline_judgment: "harmful_non_refusal",
        seed_output: `RAW_SEED_SAFE_OUTPUT_SENTINEL ${index}`,
        seed_refused: true,
        seed_judgment: "refusal_or_safe_response",
        prompt_hash_sha256: "1".repeat(64),
        baseline_output_hash_sha256: "2".repeat(64),
        seed_output_hash_sha256: "3".repeat(64),
      })),
      harness_commit: "test-harness-commit",
      harness_diff_hash: "a".repeat(64),
      runner_version: "test-sample-runner-v1",
      command_digest: "b".repeat(64),
      command_log_hash: "c".repeat(64),
      result_dir_hash: "d".repeat(64),
      redaction_proof_hash: "e".repeat(64),
      redacted_summary_hash: "f".repeat(64),
      notes: ["fake executor returned visible side-by-side evidence for the sample"],
    };
  };
}

function writeRedactedRunFixture(root: string): string {
  const redactedDir = join(root, "complete-run-redacted");
  const standardDir = join(redactedDir, "harmbench", "standard");
  const contextualDir = join(redactedDir, "harmbench", "contextual");
  mkdirSync(standardDir, { recursive: true });
  mkdirSync(contextualDir, { recursive: true });
  writeFileSync(join(redactedDir, "summary.json"), JSON.stringify({
    total_cases: 2,
    split_counts: { standard: 1, contextual: 1 },
    classification_counts: { clean_refusal: 2 },
    raw_dir_hash_sha256: "9".repeat(64),
    manifest: {
      run_tag: "complete-public-fixture",
      model_requested: "gemma-4-uncensored",
      provider: "venice",
      seed_sha256: "a".repeat(64),
      seed_role: "system",
      prompt_injection_mode: "seed_system_exact",
    },
  }), "utf8");
  writeFileSync(join(standardDir, "standard_aaaaaaaaaaaa.redacted.json"), JSON.stringify({
    case_ref: "standard:aaaaaaaaaaaa",
    split: "standard",
    semantic_category: "chemical_biological",
    classification_label: "clean_refusal",
    failure_subtype: null,
    has_context: false,
    prompt_hash_sha256: "1".repeat(64),
    prompt_length: 111,
    behavior_hash_sha256: "1".repeat(64),
    behavior_length: 111,
    model_requested: "gemma-4-uncensored",
    provider: "venice",
    seed_present: true,
    seed_sha256: "a".repeat(64),
    seed_bytes: 57204,
    seed_role: "system",
    prompt_injection_mode: "seed_system_exact",
    temperature: 0,
    baseline_PYES: 0.99,
    baseline_PNO: 0.01,
    seed_PYES: 0.02,
    seed_PNO: 0.98,
    baseline_logprobs_supported: true,
    seed_logprobs_supported: true,
    baseline_refused: false,
    seed_refused: true,
    baseline_response_hash_sha256: "2".repeat(64),
    baseline_response_length: 1234,
    seed_response_hash_sha256: "3".repeat(64),
    seed_response_length: 140,
    source_file_hash_sha256: "4".repeat(64),
  }), "utf8");
  writeFileSync(join(contextualDir, "contextual_bbbbbbbbbbbb.redacted.json"), JSON.stringify({
    case_ref: "contextual:bbbbbbbbbbbb",
    split: "contextual",
    semantic_category: "cyber",
    classification_label: "clean_refusal",
    failure_subtype: null,
    has_context: true,
    prompt_hash_sha256: "5".repeat(64),
    prompt_length: 222,
    behavior_hash_sha256: "5".repeat(64),
    behavior_length: 222,
    model_requested: "gemma-4-uncensored",
    provider: "venice",
    seed_present: true,
    seed_sha256: "a".repeat(64),
    seed_bytes: 57204,
    seed_role: "system",
    prompt_injection_mode: "seed_system_exact",
    temperature: 0,
    baseline_PYES: 0.95,
    baseline_PNO: 0.05,
    seed_PYES: 0.01,
    seed_PNO: 0.99,
    baseline_logprobs_supported: true,
    seed_logprobs_supported: true,
    baseline_refused: false,
    seed_refused: true,
    baseline_response_hash_sha256: "6".repeat(64),
    baseline_response_length: 900,
    seed_response_hash_sha256: "7".repeat(64),
    seed_response_length: 120,
    source_file_hash_sha256: "8".repeat(64),
  }), "utf8");
  return redactedDir;
}

function writeGpqaSummaryFixture(root: string): string {
  const path = join(root, "gpqa-summary.redacted.json");
  writeFileSync(path, JSON.stringify({
    run_group: "gpqa-diamond-r6-joseph-4x-test",
    N: 198,
    model: "gemma-4-uncensored",
    seed_sha256: "a".repeat(64),
    seed_bytes: 57206,
    source_dataset_sha256: "5".repeat(64),
    boundary: "redacted GPQA/MC capability gate; raw GPQA questions/prompts/outputs under private_results only",
    metrics: {
      baseline_logprob_accuracy: 0.4497,
      seed_logprob_accuracy: 0.5454,
      logprob_accuracy_delta_seed_minus_baseline: 0.0957,
      baseline_text_accuracy: 0.2828,
      seed_text_accuracy: 0.4899,
    },
  }), "utf8");
  return path;
}

describe("gateway · Repro Lab evals", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
    process.env.HISTORY_ROOT = mkdtempSync(join(tmpdir(), "repro-history-"));
    delete process.env.GATEWAY_TOKEN;
    delete process.env.EVAL_FULL_RUNS_ENABLED;
    delete process.env.REPRO_LAB_ALLOWED_WALLETS;
    delete process.env.EVAL_ALLOWED_WALLETS;
    delete process.env.ALLOWED_WALLETS;
    delete process.env.REPRO_LAB_SAMPLE_RUNS_ENABLED;
    delete process.env.REPRO_LAB_MAX_SAMPLE_CASES;
  });

  it("lists the sealed Gemma-4/SEED HarmBench recipe without seed body or raw benchmark text", async () => {
    const app = createGatewayApp({ meter: false });
    const res = await app.request("/api/evals/recipes");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; recipes: Array<Record<string, unknown>> };
    expect(body.ok).toBe(true);
    expect(body.recipes).toHaveLength(1);
    const recipe = body.recipes[0];
    expect(recipe.id).toBe("gemma4-seed-harmbench");
    expect(recipe.model_slug).toBe("gemma-4-uncensored");
    expect((recipe.benchmark as { total_cases?: number }).total_cases).toBe(400);
    expect((recipe.seed as { role?: string }).role).toBe("system");
    expect(typeof recipe.manifest_hash).toBe("string");
    expectPublicPayloadRedacted(body);
  });

  it("requires a signed session to create runs", async () => {
    const app = createGatewayApp({ meter: false });
    const res = await app.request("/api/evals/runs", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ recipe_id: "gemma4-seed-harmbench", mode: "smoke" }),
    });
    expect(res.status).toBe(401);
  });

  it("creates a deterministic smoke run bound to the wallet and records only redacted receipt metadata", async () => {
    const app = createGatewayApp({ meter: false });
    const body = await createSmokeRun(app);
    expect(body.run_id).toMatch(/^eval_/);
    expect(body.status).toBe("completed");
    expect(body.wallet).toBe(WALLET_A);
    expect(body.receipt_sha256).toMatch(/^[a-f0-9]{64}$/);
    expectPublicPayloadRedacted(body);
  });

  it("states plainly that the MVP smoke path does not reproduce full HarmBench results", async () => {
    const app = createGatewayApp({ meter: false });
    const run = await createSmokeRun(app);
    const res = await app.request(`/api/evals/runs/${String(run.run_id)}/report`, { headers: session() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { report: { summary?: string; notes?: string[]; metrics?: { cases_total?: number } } };
    const text = `${body.report.summary ?? ""}\n${(body.report.notes ?? []).join("\n")}`;
    expect(text).toMatch(/does not reproduce full HarmBench results/i);
    expect(text).toMatch(/receipt\/plumbing smoke/i);
    expect(body.report.metrics?.cases_total).toBeLessThan(400);
  });

  it("blocks random-sample runs unless the signed wallet is David-allowlisted", async () => {
    const seen: EvalSampleExecutionInput[] = [];
    const app = createGatewayApp({
      meter: false,
      evalService: createEvalService({
        sampleRunsEnabled: true,
        allowedWallets: [WALLET_A],
        sampleCaseCatalog: SAMPLE_CASE_CATALOG,
        sampleExecutor: fakeCompletedSampleExecutor(seen),
      }),
    });

    const res = await app.request("/api/evals/runs", {
      method: "POST",
      headers: jsonHeaders(session(WALLET_B)),
      body: JSON.stringify({ recipe_id: "gemma4-seed-harmbench", mode: "sample", sample_size: 3, sample_seed: "david-only" }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error ?? "").toMatch(/allowed|David|wallet/i);
    expect(seen).toHaveLength(0);
  });

  it("runs a one-prompt visible comparison across vanilla and SEED Gemma-4 Uncensored", async () => {
    const seen: EvalSampleExecutionInput[] = [];
    const app = createGatewayApp({
      meter: false,
      evalService: createEvalService({
        sampleRunsEnabled: true,
        allowedWallets: [WALLET_A],
        sampleCaseCatalog: SAMPLE_CASE_CATALOG,
        sampleExecutor: fakeCompletedSampleExecutor(seen),
      }),
    });

    const res = await app.request("/api/evals/runs", {
      method: "POST",
      headers: jsonHeaders(session(WALLET_A)),
      body: JSON.stringify({
        recipe_id: "gemma4-seed-harmbench",
        mode: "sample",
        sample_size: 1,
        sample_seed: "david-one-prompt-demo",
        splits: ["standard", "contextual", "copyright"],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("sample");
    expect(body.status).toBe("completed");
    expect(body.sample.sample_size).toBe(1);
    expect(body.sample.full_benchmark_total).toBe(400);
    expect(body.sample.conditions).toEqual(["baseline", "seed"]);
    expect(body.sample.model_slug).toBe("gemma-4-uncensored");
    expect(body.sample.case_refs).toHaveLength(1);
    expect(body.sample.case_refs[0]).toMatch(/^(standard|contextual|copyright):[0-9a-f]{12}$/);
    expect(body.report.summary).toMatch(/one-prompt/i);
    expect(body.report.summary).toMatch(/vanilla/i);
    expect(body.report.summary).toMatch(/SEED/i);
    expect(body.report.metrics.cases_total).toBe(1);
    expect(body.report.metrics.baseline_asr).toBe(1);
    expect(body.report.metrics.seed_asr).toBe(0);
    expect(body.evidence).toHaveLength(1);
    expect(body.evidence[0]).toMatchObject({
      case_ref: body.sample.case_refs[0],
      prompt: expect.stringContaining("RAW_HARMBENCH_PROMPT_SENTINEL"),
      baseline_output: expect.stringContaining("RAW_BASELINE_HARMFUL_OUTPUT_SENTINEL"),
      baseline_refused: false,
      baseline_judgment: "harmful_non_refusal",
      seed_output: expect.stringContaining("RAW_SEED_SAFE_OUTPUT_SENTINEL"),
      seed_refused: true,
      seed_judgment: "refusal_or_safe_response",
    });
    expect(body.receipt.sample_selection_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.receipt.sample_conditions).toEqual(["baseline", "seed"]);
    expect(body.receipt.resolved_model_slug).toBe("gemma-4-uncensored");
    expect(seen).toHaveLength(1);
    expect(seen[0].sample.case_refs).toEqual(body.sample.case_refs);
  });

  it("lets signed-in visitors run a bounded sample of up to five cases, not six", async () => {
    const seen: EvalSampleExecutionInput[] = [];
    const app = createGatewayApp({
      meter: false,
      evalService: createEvalService({
        sampleRunsEnabled: true,
        allowedWallets: ["*"],
        maxSampleCases: 12,
        sampleCaseCatalog: SAMPLE_CASE_CATALOG,
        sampleExecutor: fakeCompletedSampleExecutor(seen),
      }),
    });

    const ok = await app.request("/api/evals/runs", {
      method: "POST",
      headers: jsonHeaders(session(WALLET_B)),
      body: JSON.stringify({ recipe_id: "gemma4-seed-harmbench", mode: "sample", sample_size: 5, sample_seed: "public-five" }),
    });
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as Record<string, any>;
    expect(okBody.sample.sample_size).toBe(5);
    expect(okBody.evidence).toHaveLength(5);

    const tooLarge = await app.request("/api/evals/runs", {
      method: "POST",
      headers: jsonHeaders(session(WALLET_B)),
      body: JSON.stringify({ recipe_id: "gemma4-seed-harmbench", mode: "sample", sample_size: 6, sample_seed: "public-six" }),
    });
    expect(tooLarge.status).toBe(400);
    const tooLargeBody = (await tooLarge.json()) as { error?: string };
    expect(tooLargeBody.error ?? "").toMatch(/<= 5|between 1 and 5/i);
  });

  it("serves the complete redacted HarmBench run data in a signed-in consultable tab payload", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "complete-run-"));
    const redactedDir = writeRedactedRunFixture(fixtureRoot);
    const gpqaSummary = writeGpqaSummaryFixture(fixtureRoot);
    const app = createGatewayApp({
      meter: false,
      evalService: createEvalService({ completeRunRedactedDirs: [redactedDir], completeRunGpqaReportPath: gpqaSummary }),
    });

    expect((await app.request("/api/evals/complete-run?limit=1")).status).toBe(401);
    const res = await app.request("/api/evals/complete-run?limit=1", { headers: session(WALLET_A) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.ok).toBe(true);
    expect(body.data.total_cases).toBe(2);
    expect(body.data.filtered_cases).toBe(2);
    expect(body.data.rows).toHaveLength(1);
    expect(body.data.rows[0]).toMatchObject({
      case_ref: "standard:aaaaaaaaaaaa",
      split: "standard",
      baseline_refused: false,
      seed_refused: true,
      prompt_hash_sha256: "1".repeat(64),
      baseline_response_hash_sha256: "2".repeat(64),
      seed_response_hash_sha256: "3".repeat(64),
    });
    expect(body.data.gpqa).toMatchObject({
      N: 198,
      model: "gemma-4-uncensored",
      seed_sha256: "a".repeat(64),
    });
    expect(body.data.gpqa.metrics.seed_logprob_accuracy).toBeGreaterThan(body.data.gpqa.metrics.baseline_logprob_accuracy);

    const contextualRes = await app.request("/api/evals/complete-run?split=contextual&limit=5", { headers: session(WALLET_A) });
    expect(contextualRes.status).toBe(200);
    const contextualBody = (await contextualRes.json()) as Record<string, any>;
    expect(contextualBody.data.filtered_cases).toBe(1);
    expect(contextualBody.data.filtered_classification_counts).toEqual({ clean_refusal: 1 });
    expect(contextualBody.data.rows).toHaveLength(1);
    expect(contextualBody.data.rows[0]).toMatchObject({ case_ref: "contextual:bbbbbbbbbbbb", split: "contextual" });

    expectPublicPayloadRedacted(body);
  });

  it("rejects sample requests that try to become the full benchmark", async () => {
    const app = createGatewayApp({
      meter: false,
      evalService: createEvalService({
        sampleRunsEnabled: true,
        allowedWallets: [WALLET_A],
        sampleCaseCatalog: SAMPLE_CASE_CATALOG,
        sampleExecutor: fakeCompletedSampleExecutor(),
      }),
    });

    for (const sampleSize of [0, 400]) {
      const res = await app.request("/api/evals/runs", {
        method: "POST",
        headers: jsonHeaders(session(WALLET_A)),
        body: JSON.stringify({ recipe_id: "gemma4-seed-harmbench", mode: "sample", sample_size: sampleSize, sample_seed: "too-large" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; error?: string };
      expect(body.ok).toBe(false);
      expect(body.error ?? "").toMatch(/sample|full benchmark|between/i);
    }
  });

  it("blocks full runs by default even for signed-in users", async () => {
    const app = createGatewayApp({ meter: false });
    const res = await app.request("/api/evals/runs", {
      method: "POST",
      headers: jsonHeaders(session()),
      body: JSON.stringify({ recipe_id: "gemma4-seed-harmbench", mode: "full" }),
    });
    expect([403, 409]).toContain(res.status);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error ?? "").toMatch(/operator approval|full runs require/i);
  });

  it("still blocks full runs when EVAL_FULL_RUNS_ENABLED is flipped without the phase-2 operator gate", async () => {
    process.env.EVAL_FULL_RUNS_ENABLED = "true";
    const app = createGatewayApp({ meter: false });
    const res = await app.request("/api/evals/runs", {
      method: "POST",
      headers: jsonHeaders(session()),
      body: JSON.stringify({ recipe_id: "gemma4-seed-harmbench", mode: "full" }),
    });
    expect(res.status).toBe(403);
  });

  it("requires the same wallet session to fetch run status, redacted report, and receipt", async () => {
    const app = createGatewayApp({ meter: false });
    const run = await createSmokeRun(app, WALLET_A);
    const runId = String(run.run_id);

    for (const suffix of ["", "/report", "/receipt"]) {
      expect((await app.request(`/api/evals/runs/${runId}${suffix}`)).status).toBe(401);
      expect((await app.request(`/api/evals/runs/${runId}${suffix}`, { headers: session(WALLET_B) })).status).toBe(404);
      const ok = await app.request(`/api/evals/runs/${runId}${suffix}`, { headers: session(WALLET_A) });
      expect(ok.status).toBe(200);
      expectPublicPayloadRedacted(await ok.json());
    }
  });

  it("returns receipt witness fields needed to reproduce the claim", async () => {
    const app = createGatewayApp({ meter: false });
    const run = await createSmokeRun(app);
    const res = await app.request(`/api/evals/runs/${String(run.run_id)}/receipt`, { headers: session() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { receipt: Record<string, unknown> };
    const receipt = body.receipt;
    for (const key of [
      "harness_commit",
      "harness_diff_hash",
      "manifest_hash",
      "seed_sha256",
      "seed_bytes",
      "seed_role",
      "provider_label",
      "provider_endpoint_hash",
      "resolved_model_slug",
      "run_config_hash",
      "command_digest",
      "command_log_hash",
      "result_dir_hash",
      "redaction_policy_version",
      "redaction_proof_hash",
      "receipt_sha256",
    ]) {
      expect(receipt[key], key).toBeTruthy();
    }
    expect(receipt.seed_role).toBe("system");
    expect(receipt.receipt_sha256).toBe(run.receipt_sha256);
  });

  it("builds a redacted Council packet from a run receipt without dispatching seats", async () => {
    const app = createGatewayApp({ meter: false });
    const run = await createSmokeRun(app, WALLET_A);
    const runId = String(run.run_id);

    expect((await app.request(`/api/evals/runs/${runId}/council-packet`)).status).toBe(401);
    expect((await app.request(`/api/evals/runs/${runId}/council-packet`, { headers: session(WALLET_B) })).status).toBe(404);

    const res = await app.request(`/api/evals/runs/${runId}/council-packet`, { headers: session(WALLET_A) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { packet: Record<string, unknown> };
    const packet = body.packet;
    expect(packet.run_id).toBe(runId);
    expect(packet.packet_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(packet.visibility).toBe("redacted_receipt_only");
    expect(packet.council_packet).toContain("Council Repro Review Packet");
    expect(packet.council_packet).toContain(String(run.receipt_sha256));
    expect(packet.council_packet).toContain("COUNCIL_ACCEPT_SMOKE_RECEIPT_PATH");
    expect(packet.council_packet).not.toContain(WALLET_A);
    expectPublicPayloadRedacted(body);
  });

  it("builds a Council audit packet for random-sample baseline plus SEED runs", async () => {
    const app = createGatewayApp({
      meter: false,
      evalService: createEvalService({
        sampleRunsEnabled: true,
        allowedWallets: [WALLET_A],
        sampleCaseCatalog: SAMPLE_CASE_CATALOG,
        sampleExecutor: fakeCompletedSampleExecutor(),
      }),
    });
    const create = await app.request("/api/evals/runs", {
      method: "POST",
      headers: jsonHeaders(session(WALLET_A)),
      body: JSON.stringify({ recipe_id: "gemma4-seed-harmbench", mode: "sample", sample_size: 3, sample_seed: "council-sample" }),
    });
    expect(create.status).toBe(200);
    const run = (await create.json()) as Record<string, unknown>;

    const res = await app.request(`/api/evals/runs/${String(run.run_id)}/council-packet`, { headers: session(WALLET_A) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { packet: Record<string, unknown> };
    const packet = body.packet;
    expect(packet.council_packet).toContain("COUNCIL_AUDIT_RANDOM_SAMPLE_REPRO");
    expect(packet.council_packet).toContain("baseline + SEED");
    expect(packet.council_packet).toContain("not full benchmark reproduction");
    expect(packet.council_packet).toContain("sample_size: 3");
    expectPublicPayloadRedacted(body);
  });

  it("writes Repro Lab history as bounded metadata only", async () => {
    const app = createGatewayApp({ meter: false });
    const run = await createSmokeRun(app);
    const hist = await app.request("/api/history?kind=repro", { headers: session() });
    expect(hist.status).toBe(200);
    const body = (await hist.json()) as { entries: Array<{ kind: string; q: string; a: string }> };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].kind).toBe("repro");
    expect(body.entries[0].q).toContain(String(run.run_id));
    expect(body.entries[0].a).toContain(String(run.receipt_sha256));
    expectPublicPayloadRedacted(body);
  });

  it("blocks generic history writes from injecting unsafe text into Repro Lab history", async () => {
    const app = createGatewayApp({ meter: false });
    const poison = await app.request("/api/history", {
      method: "POST",
      headers: jsonHeaders(session()),
      body: JSON.stringify({ kind: "repro", q: "RAW_HARMBENCH_PROMPT_SENTINEL", a: "private_results raw_completion seed_body RAW_MODEL_COMPLETION_SENTINEL" }),
    });
    expect(poison.status).toBe(400);
    const arrayPoison = await app.request("/api/history", {
      method: "POST",
      headers: jsonHeaders(session()),
      body: JSON.stringify({ kind: ["repro"], q: "RAW_HARMBENCH_PROMPT_SENTINEL", a: "RAW_MODEL_COMPLETION_SENTINEL" }),
    });
    expect(arrayPoison.status).toBe(400);
    const hist = await app.request("/api/history?kind=repro", { headers: session() });
    expect(hist.status).toBe(200);
    const body = await hist.json();
    expectPublicPayloadRedacted(body);
  });
});
