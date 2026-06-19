import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type EvalMode = "smoke" | "sample" | "full";
export type EvalRunStatus = "queued" | "running" | "completed" | "failed" | "blocked";
export type EvalSplit = "standard" | "contextual" | "copyright";
export type EvalSampleCondition = "baseline" | "seed";

export type EvalRecipe = {
  id: string;
  recipe_version: string;
  title: string;
  model_slug: string;
  provider_label: string;
  seed: {
    sha256: string;
    bytes: number;
    role: "system";
    system_role_proof: {
      message_array_role: "system";
      seed_not_in_user_input: true;
    };
  };
  benchmark: {
    name: "HarmBench";
    standard_cases: number;
    contextual_cases: number;
    copyright_cases: number;
    total_cases: number;
  };
  manifest_hash: string;
  supported_modes: EvalMode[];
  public_boundary: string[];
};

export type EvalMetrics = {
  cases_total: number;
  baseline_refusals: number;
  seed_refusals: number;
  baseline_asr: number;
  seed_asr: number;
  marker_nonrefusal_count: number;
};

export type EvalReport = {
  summary: string;
  mode: EvalMode;
  metrics: EvalMetrics;
  hashes: {
    redacted_report_hash: string;
    receipt_sha256: string;
    redacted_summary_hash?: string;
  };
  notes: string[];
};

export type EvalReceipt = {
  recipe_id: string;
  recipe_version: string;
  run_id: string;
  mode: EvalMode;
  wallet: string;
  created_at: string;
  model_slug: string;
  provider_label: string;
  provider_endpoint_hash: string;
  resolved_model_slug: string;
  seed_sha256: string;
  seed_bytes: number;
  seed_role: "system";
  system_role_proof: {
    message_array_role: "system";
    seed_not_in_user_input: true;
  };
  benchmark_name: string;
  benchmark_split_counts: {
    standard: number;
    contextual: number;
    copyright: number;
    total: number;
  };
  manifest_hash: string;
  manifest_source_hash_kind: string;
  harness_commit: string;
  harness_diff_hash: string;
  runner_version: string;
  run_config_hash: string;
  command_digest: string;
  command_log_hash: string;
  result_dir_hash: string;
  redaction_policy_version: string;
  redaction_proof_hash: string;
  redacted_report_hash: string;
  receipt_sha256: string;
  sample_size?: number;
  sample_seed?: string;
  sample_splits?: EvalSplit[];
  sample_case_refs?: string[];
  sample_case_refs_hash?: string;
  sample_selection_hash?: string;
  sample_conditions?: EvalSampleCondition[];
  sample_full_benchmark_total?: number;
};

export type EvalSamplePlan = {
  kind: "random_harmbench_sample";
  sample_size: number;
  sample_seed: string;
  splits: EvalSplit[];
  case_refs: string[];
  case_refs_hash: string;
  selection_hash: string;
  conditions: EvalSampleCondition[];
  model_slug: string;
  full_benchmark_total: number;
};

export type EvalEvidenceRow = {
  case_ref: string;
  split: EvalSplit | string;
  prompt: string;
  baseline_output: string;
  baseline_refused: boolean | null;
  baseline_judgment: string;
  seed_output: string;
  seed_refused: boolean | null;
  seed_judgment: string;
  prompt_hash_sha256: string | null;
  baseline_output_hash_sha256: string | null;
  seed_output_hash_sha256: string | null;
};

export type EvalCompleteRunRow = {
  case_ref: string;
  split: EvalSplit | string;
  semantic_category: string | null;
  classification_label: string | null;
  failure_subtype: string | null;
  has_context: boolean | null;
  baseline_refused: boolean | null;
  seed_refused: boolean | null;
  baseline_PYES: number | null;
  baseline_PNO: number | null;
  seed_PYES: number | null;
  seed_PNO: number | null;
  prompt_hash_sha256: string | null;
  prompt_length: number | null;
  behavior_hash_sha256: string | null;
  behavior_length: number | null;
  baseline_response_hash_sha256: string | null;
  baseline_response_length: number | null;
  seed_response_hash_sha256: string | null;
  seed_response_length: number | null;
  source_file_hash_sha256: string | null;
  model_requested: string | null;
  provider: string | null;
  seed_present: boolean | null;
  seed_sha256: string | null;
  seed_bytes: number | null;
  seed_role: string | null;
  prompt_injection_mode: string | null;
  temperature: number | null;
};

export type EvalCompleteRunData = {
  run_id: string;
  title: string;
  model_slug: string;
  benchmark_name: "HarmBench";
  public_boundary: string[];
  total_cases: number;
  filtered_cases: number;
  returned: number;
  offset: number;
  limit: number;
  split_counts: Record<string, number>;
  classification_counts: Record<string, number>;
  filtered_classification_counts: Record<string, number>;
  seed_sha256: string | null;
  seed_role: string | null;
  provider: string | null;
  prompt_injection_mode: string | null;
  gpqa: EvalGpqaSummary | null;
  rows: EvalCompleteRunRow[];
};

export type EvalGpqaSummary = {
  run_id: string;
  N: number;
  model: string | null;
  seed_sha256: string | null;
  seed_bytes: number | null;
  source_dataset_sha256: string | null;
  boundary: string | null;
  metrics: Record<string, unknown>;
};

export type EvalCompleteRunQuery = {
  split?: EvalSplit;
  offset?: number;
  limit?: number;
  q?: string;
};

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
  sample?: EvalSamplePlan;
  evidence?: EvalEvidenceRow[];
};

export type EvalCouncilPacket = {
  run_id: string;
  recipe_id: string;
  mode: EvalMode;
  receipt_sha256: string;
  packet_sha256: string;
  visibility: "redacted_receipt_only";
  prepared_at: string;
  requested_tokens: string[];
  guardrails: string[];
  council_packet: string;
};

export type EvalSampleCaseRef = { split: EvalSplit; case_ref: string };

export type EvalSampleExecutionInput = {
  recipe: EvalRecipe;
  run_id: string;
  wallet: string;
  created_at: string;
  sample: EvalSamplePlan;
  redaction_policy_version: string;
};

export type EvalSampleExecutionResult = {
  status: Extract<EvalRunStatus, "completed" | "failed">;
  metrics: EvalMetrics;
  harness_commit: string;
  harness_diff_hash: string;
  runner_version: string;
  command_digest: string;
  command_log_hash: string;
  result_dir_hash: string;
  redaction_proof_hash: string;
  redacted_summary_hash: string;
  notes: string[];
  evidence?: EvalEvidenceRow[];
};

export type EvalSampleExecutor = (input: EvalSampleExecutionInput) => Promise<EvalSampleExecutionResult>;

type CreateRunInput = {
  recipeId: string;
  mode: EvalMode;
  wallet: string;
  sampleSize?: number;
  sampleSeed?: string;
  splits?: EvalSplit[];
};

type EvalServiceOptions = {
  sampleRunsEnabled?: boolean;
  allowedWallets?: string[];
  maxSampleCases?: number;
  sampleCaseCatalog?: EvalSampleCaseRef[];
  sampleExecutor?: EvalSampleExecutor;
  completeRunRedactedDirs?: string[];
  completeRunGpqaReportPath?: string;
};

const VALID_SPLITS: EvalSplit[] = ["standard", "contextual", "copyright"];
const SAMPLE_REF_RE = /^(standard|contextual|copyright):[0-9a-f]{12}$/;
const RAW_ATTACK_TYPE_TO_SPLIT: Record<string, EvalSplit> = {
  HB_STANDARD: "standard",
  HB_CONTEXTUAL: "contextual",
  HB_COPYRIGHT: "copyright",
};

function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function resolveManifestWitness(): { hash: string; sourceHashKind: string } {
  const root = process.env.EVAL_HARNESS_ROOT ?? "/home/exor/SEED-Framework-Evaluation";
  const candidate = join(root, "harmbench_data", "harmbench_behaviors_text_all.csv");
  if (existsSync(candidate)) {
    return {
      hash: sha256(readFileSync(candidate)),
      sourceHashKind: "sha256(harmbench_behaviors_text_all.csv bytes)",
    };
  }
  return {
    hash: sha256("mvp-synthetic-redacted-manifest-witness"),
    sourceHashKind: "mvp synthetic manifest hash; real CSV byte hash deferred until harness root is present",
  };
}

function envList(...names: string[]): string[] {
  for (const name of names) {
    const raw = (process.env[name] ?? "").trim();
    if (raw) return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

const PUBLIC_SAMPLE_MAX_CASES = 5;
const DEFAULT_SAMPLE_SIZE = 1;
const COMPLETE_RUN_ID = "tp5-v6-r6-joseph-arch-gated-guard-4x100-20260609T221315Z";
const DEFAULT_R6_SEED_FILE = "/home/exor/SEED-Framework-Evaluation/private_results/seed_candidates/seed-tp5-v6-r6-joseph-steward-gate-candidate.txt";
const R6_SYSTEM_SEED_SHA256 = "aa7c7c018edc72ea5e0734235f367c5ed41f346e94edca365b2a43594b526e7a";
const R6_SYSTEM_SEED_BYTES = 57204;
const DEFAULT_GPQA_SUMMARY_PATH = "/home/exor/SEED-Framework-Evaluation/reports/gpqa-diamond-r6-joseph-4x-20260609T231955Z-combined-summary.redacted.json";
const SEED_SHA256 = R6_SYSTEM_SEED_SHA256;
const MANIFEST_WITNESS = resolveManifestWitness();
const MANIFEST_HASH = MANIFEST_WITNESS.hash;
const PROVIDER_ENDPOINT_HASH = sha256("provider-endpoint:configured-outside-public-payload");
const HARNESS_DIFF_HASH = sha256("mvp-mock-harness-clean");
const RUNNER_VERSION = "repro-lab-mvp-mock-v1";
const SAMPLE_RUNNER_VERSION = "repro-lab-random-sample-v1";
const REDACTION_POLICY_VERSION = "repro-redaction-v1";

export const GEMMA4_SEED_HARMBENCH_RECIPE: EvalRecipe = {
  id: "gemma4-seed-harmbench",
  recipe_version: "mvp-2-random-sample",
  title: "Gemma-4 Uncensored · SEED HarmBench reproducibility receipt",
  model_slug: "gemma-4-uncensored",
  provider_label: "operator-configured",
  seed: {
    sha256: SEED_SHA256,
    bytes: R6_SYSTEM_SEED_BYTES,
    role: "system",
    system_role_proof: {
      message_array_role: "system",
      seed_not_in_user_input: true,
    },
  },
  benchmark: {
    name: "HarmBench",
    standard_cases: 200,
    contextual_cases: 100,
    copyright_cases: 100,
    total_cases: 400,
  },
  manifest_hash: MANIFEST_HASH,
  supported_modes: ["smoke", "sample", "full"],
  public_boundary: [
    "sample demo shows 1-5 prompts and both model outputs side by side",
    "sample/cached evidence rows bind prompt/output hashes to receipts",
    "complete-run tab exposes the full 400-case redacted evidence ledger",
    "no private seed text",
    "no private result paths or command logs",
    "full re-runs require operator gate",
    "random samples require a signed wallet and are capped at five cases",
  ],
};

export class FullRunBlockedError extends Error {
  constructor() {
    super("full runs require operator approval and remain blocked; use bounded random samples instead");
  }
}

export class SampleRunBlockedError extends Error {
  constructor(message = "random-sample runs require a signed David-allowlisted wallet") {
    super(message);
  }
}

export class EvalValidationError extends Error {}

function buildBaseReceiptFields(recipe: EvalRecipe, runId: string, wallet: string, createdAt: string, mode: EvalMode) {
  return {
    recipe_id: recipe.id,
    recipe_version: recipe.recipe_version,
    run_id: runId,
    mode,
    wallet: wallet.toLowerCase(),
    created_at: createdAt,
    model_slug: recipe.model_slug,
    provider_label: recipe.provider_label,
    provider_endpoint_hash: PROVIDER_ENDPOINT_HASH,
    resolved_model_slug: recipe.model_slug,
    seed_sha256: recipe.seed.sha256,
    seed_bytes: recipe.seed.bytes,
    seed_role: recipe.seed.role,
    system_role_proof: recipe.seed.system_role_proof,
    benchmark_name: recipe.benchmark.name,
    benchmark_split_counts: {
      standard: recipe.benchmark.standard_cases,
      contextual: recipe.benchmark.contextual_cases,
      copyright: recipe.benchmark.copyright_cases,
      total: recipe.benchmark.total_cases,
    },
    manifest_hash: recipe.manifest_hash,
    manifest_source_hash_kind: MANIFEST_WITNESS.sourceHashKind,
  } as const;
}

function finalizeRun(
  recipe: EvalRecipe,
  runId: string,
  wallet: string,
  createdAt: string,
  mode: EvalMode,
  status: EvalRunStatus,
  reportSeed: Omit<EvalReport, "hashes">,
  receiptFields: Omit<EvalReceipt, "redacted_report_hash" | "receipt_sha256">,
  sample?: EvalSamplePlan,
): EvalRun {
  const redactedReportHash = sha256(canonicalJson(reportSeed));
  const receiptWithoutHash = { ...receiptFields, redacted_report_hash: redactedReportHash } satisfies Omit<EvalReceipt, "receipt_sha256">;
  const receiptSha = sha256(canonicalJson(receiptWithoutHash));
  const receipt: EvalReceipt = { ...receiptWithoutHash, receipt_sha256: receiptSha };
  const report: EvalReport = { ...reportSeed, hashes: { redacted_report_hash: redactedReportHash, receipt_sha256: receiptSha } };
  return {
    run_id: runId,
    wallet: wallet.toLowerCase(),
    recipe_id: recipe.id,
    recipe_version: recipe.recipe_version,
    mode,
    status,
    created_at: createdAt,
    receipt_sha256: receiptSha,
    report,
    receipt,
    ...(sample ? { sample } : {}),
  };
}

function normalizeSplits(splits?: EvalSplit[]): EvalSplit[] {
  if (!splits || splits.length === 0) return [...VALID_SPLITS];
  const out: EvalSplit[] = [];
  for (const split of splits) {
    if (!VALID_SPLITS.includes(split)) throw new EvalValidationError(`unsupported split: ${String(split)}`);
    if (!out.includes(split)) out.push(split);
  }
  return out;
}

function validateSampleSize(size: number, maxSampleCases: number, fullTotal: number): number {
  if (!Number.isInteger(size) || size < 1) {
    throw new EvalValidationError(`sample_size must be between 1 and ${Math.min(maxSampleCases, fullTotal - 1)}`);
  }
  if (size >= fullTotal) {
    throw new EvalValidationError("sample_size must stay below the full benchmark total; full 400-case runs are blocked");
  }
  if (size > maxSampleCases) {
    throw new EvalValidationError(`sample_size must be <= ${maxSampleCases} for this signed-in random-sample lane`);
  }
  return size;
}

function selectSamplePlan(
  recipe: EvalRecipe,
  catalog: EvalSampleCaseRef[],
  requestedSize: number | undefined,
  sampleSeed: string | undefined,
  requestedSplits: EvalSplit[] | undefined,
  maxSampleCases: number,
): EvalSamplePlan {
  const sampleSize = validateSampleSize(requestedSize ?? DEFAULT_SAMPLE_SIZE, maxSampleCases, recipe.benchmark.total_cases);
  const splits = normalizeSplits(requestedSplits);
  const seed = (sampleSeed?.trim() || `random-${randomUUID()}`).slice(0, 128);
  const eligible = catalog
    .filter((item) => splits.includes(item.split) && SAMPLE_REF_RE.test(item.case_ref))
    .filter((item, index, arr) => arr.findIndex((other) => other.case_ref === item.case_ref) === index);
  if (eligible.length < sampleSize) {
    throw new EvalValidationError(`sample_size ${sampleSize} exceeds available redacted case refs for selected splits (${eligible.length})`);
  }
  const selected = eligible
    .map((item) => ({ item, score: sha256(`${seed}\u0000${item.case_ref}`) }))
    .sort((a, b) => a.score.localeCompare(b.score))
    .slice(0, sampleSize)
    .map(({ item }) => item.case_ref)
    .sort();
  const caseRefsHash = sha256(canonicalJson(selected));
  const conditions: EvalSampleCondition[] = ["baseline", "seed"];
  const selectionHash = sha256(canonicalJson({
    kind: "random_harmbench_sample",
    sample_size: sampleSize,
    sample_seed: seed,
    splits,
    case_refs_hash: caseRefsHash,
    conditions,
    model_slug: recipe.model_slug,
    full_benchmark_total: recipe.benchmark.total_cases,
  }));
  return {
    kind: "random_harmbench_sample",
    sample_size: sampleSize,
    sample_seed: seed,
    splits,
    case_refs: selected,
    case_refs_hash: caseRefsHash,
    selection_hash: selectionHash,
    conditions,
    model_slug: recipe.model_slug,
    full_benchmark_total: recipe.benchmark.total_cases,
  };
}

function loadCaseCatalogFromHarness(): EvalSampleCaseRef[] {
  const root = process.env.EVAL_HARNESS_ROOT ?? "/home/exor/SEED-Framework-Evaluation";
  const python = process.env.EVAL_HARNESS_PYTHON ?? "python3";
  const script = String.raw`
import contextlib, hashlib, io, json, sys
from pathlib import Path
root = Path.cwd()
sys.path.insert(0, str(root))
from loaders import load_all_harmbench
splits = {"standard":"HB_STANDARD", "contextual":"HB_CONTEXTUAL", "copyright":"HB_COPYRIGHT"}
with contextlib.redirect_stdout(io.StringIO()):
    standard, contextual, copyright = load_all_harmbench()
rows_by_split = {"standard": standard, "contextual": contextual, "copyright": copyright}
out = []
for split, rows in rows_by_split.items():
    prefix = splits[split]
    for row in rows:
        attack_id = f"{prefix}_{row.get('index','')}"
        ref = f"{split}:{hashlib.sha256(attack_id.encode('utf-8')).hexdigest()[:12]}"
        out.append({"split": split, "case_ref": ref})
print(json.dumps(out, separators=(",", ":")))
`;
  const proc = spawnSync(python, ["-c", script], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    env: process.env,
  });
  if (proc.status !== 0) {
    throw new EvalValidationError("could not load HarmBench redacted case catalog from harness root");
  }
  const parsed = JSON.parse(proc.stdout) as EvalSampleCaseRef[];
  return parsed.filter((item) => VALID_SPLITS.includes(item.split) && SAMPLE_REF_RE.test(item.case_ref));
}

function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true });
  try { chmodSync(path, 0o700); } catch {}
}

function gitValue(root: string, args: string[], fallback: string): string {
  const proc = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (proc.status !== 0) return fallback;
  return proc.stdout.trim() || fallback;
}

function walkJsonFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...walkJsonFiles(path));
    else if (entry.isFile() && path.endsWith(".redacted.json")) out.push(path);
  }
  return out;
}

function metricsFromRedacted(redactedDir: string): EvalMetrics {
  const cases = walkJsonFiles(redactedDir).map((path) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>);
  const total = cases.length;
  const baselineRefusals = cases.filter((c) => c.baseline_refused === true).length;
  const seedRefusals = cases.filter((c) => c.seed_refused === true).length;
  const markerNonrefusal = cases.filter((c) => c.classification_label === "marker_surface_without_obedience" || c.classification_label === "high_PYES_nonrefusal_needs_review").length;
  return {
    cases_total: total,
    baseline_refusals: baselineRefusals,
    seed_refusals: seedRefusals,
    baseline_asr: total > 0 ? 1 - baselineRefusals / total : 0,
    seed_asr: total > 0 ? 1 - seedRefusals / total : 0,
    marker_nonrefusal_count: markerNonrefusal,
  };
}

function walkRawResultFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...walkRawResultFiles(path));
    else if (entry.isFile() && path.endsWith(".json") && !["manifest.json", "master_results.json"].includes(entry.name)) out.push(path);
  }
  return out.sort();
}

function splitFromRaw(raw: Record<string, unknown>, path: string): EvalSplit | string {
  const attackType = typeof raw.attack_type === "string" ? raw.attack_type : "";
  const mapped = RAW_ATTACK_TYPE_TO_SPLIT[attackType];
  if (mapped) return mapped;
  for (const split of VALID_SPLITS) {
    if (path.includes(`${split}/`) || path.includes(`/${split}`)) return split;
  }
  return "unknown";
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function visibleJudgment(refused: boolean | null): string {
  if (refused === true) return "refusal_or_safe_response";
  if (refused === false) return "harmful_non_refusal";
  return "unclassified";
}

function contentFromBlock(block: unknown): string {
  if (!block || typeof block !== "object") return "";
  const content = (block as Record<string, unknown>).content;
  if (typeof content === "string") return content;
  const error = (block as Record<string, unknown>).error;
  return typeof error === "string" ? `[error] ${error}` : "";
}

function refusedFromBlock(block: unknown): boolean | null {
  if (!block || typeof block !== "object") return null;
  return boolOrNull((block as Record<string, unknown>).refused);
}

function evidenceFromRaw(rawDir: string): EvalEvidenceRow[] {
  return walkRawResultFiles(rawDir).map((path) => {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const split = splitFromRaw(raw, path);
    const attackId = typeof raw.attack_id === "string" ? raw.attack_id : path;
    const caseRef = `${split}:${sha256(attackId).slice(0, 12)}`;
    const prompt = typeof raw.prompt === "string" ? raw.prompt : "";
    const baselineOutput = contentFromBlock(raw.baseline_full);
    const seedOutput = contentFromBlock(raw.seed_full);
    const baselineRefused = refusedFromBlock(raw.baseline_full) ?? boolOrNull((raw.metrics as Record<string, unknown> | undefined)?.baseline_refused);
    const seedRefused = refusedFromBlock(raw.seed_full) ?? boolOrNull((raw.metrics as Record<string, unknown> | undefined)?.seed_refused);
    return {
      case_ref: caseRef,
      split,
      prompt,
      baseline_output: baselineOutput,
      baseline_refused: baselineRefused,
      baseline_judgment: visibleJudgment(baselineRefused),
      seed_output: seedOutput,
      seed_refused: seedRefused,
      seed_judgment: visibleJudgment(seedRefused),
      prompt_hash_sha256: prompt ? sha256(prompt) : null,
      baseline_output_hash_sha256: baselineOutput ? sha256(baselineOutput) : null,
      seed_output_hash_sha256: seedOutput ? sha256(seedOutput) : null,
    };
  });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function walkRedactedResultFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...walkRedactedResultFiles(path));
    else if (entry.isFile() && path.endsWith(".redacted.json")) out.push(path);
  }
  return out.sort();
}

function envPathList(name: string): string[] {
  const raw = (process.env[name] ?? "").trim();
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function defaultCompleteRunRedactedDirs(): string[] {
  const fromEnv = envPathList("REPRO_LAB_COMPLETE_RUN_REDACTED_DIRS");
  if (fromEnv.length > 0) return fromEnv;
  const root = process.env.EVAL_HARNESS_ROOT ?? "/home/exor/SEED-Framework-Evaluation";
  const base = join(root, "results", "gemma-4-uncensored");
  return [
    join(base, `${COMPLETE_RUN_ID}-a-standard001-100-redacted`),
    join(base, `${COMPLETE_RUN_ID}-b-standard101-200-redacted`),
    join(base, `${COMPLETE_RUN_ID}-c-contextual001-100-redacted`),
    join(base, `${COMPLETE_RUN_ID}-d-copyright001-100-redacted`),
  ];
}

function readCompleteRunRows(redactedDirs: string[]): EvalCompleteRunRow[] {
  const rows: EvalCompleteRunRow[] = [];
  for (const dir of redactedDirs) {
    for (const path of walkRedactedResultFiles(dir)) {
      const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      rows.push({
        case_ref: stringOrNull(raw.case_ref) ?? `${stringOrNull(raw.split) ?? "unknown"}:${sha256(path).slice(0, 12)}`,
        split: stringOrNull(raw.split) ?? "unknown",
        semantic_category: stringOrNull(raw.semantic_category),
        classification_label: stringOrNull(raw.classification_label),
        failure_subtype: stringOrNull(raw.failure_subtype),
        has_context: boolOrNull(raw.has_context),
        baseline_refused: boolOrNull(raw.baseline_refused),
        seed_refused: boolOrNull(raw.seed_refused),
        baseline_PYES: numberOrNull(raw.baseline_PYES),
        baseline_PNO: numberOrNull(raw.baseline_PNO),
        seed_PYES: numberOrNull(raw.seed_PYES),
        seed_PNO: numberOrNull(raw.seed_PNO),
        prompt_hash_sha256: stringOrNull(raw.prompt_hash_sha256),
        prompt_length: numberOrNull(raw.prompt_length),
        behavior_hash_sha256: stringOrNull(raw.behavior_hash_sha256),
        behavior_length: numberOrNull(raw.behavior_length),
        baseline_response_hash_sha256: stringOrNull(raw.baseline_response_hash_sha256),
        baseline_response_length: numberOrNull(raw.baseline_response_length),
        seed_response_hash_sha256: stringOrNull(raw.seed_response_hash_sha256),
        seed_response_length: numberOrNull(raw.seed_response_length),
        source_file_hash_sha256: stringOrNull(raw.source_file_hash_sha256),
        model_requested: stringOrNull(raw.model_requested),
        provider: stringOrNull(raw.provider),
        seed_present: boolOrNull(raw.seed_present),
        seed_sha256: stringOrNull(raw.seed_sha256),
        seed_bytes: numberOrNull(raw.seed_bytes),
        seed_role: stringOrNull(raw.seed_role),
        prompt_injection_mode: stringOrNull(raw.prompt_injection_mode),
        temperature: numberOrNull(raw.temperature),
      });
    }
  }
  return rows.sort((a, b) => {
    const splitOrder = (split: string) => VALID_SPLITS.indexOf(split as EvalSplit);
    const aOrder = splitOrder(String(a.split));
    const bOrder = splitOrder(String(b.split));
    const ao = aOrder === -1 ? 99 : aOrder;
    const bo = bOrder === -1 ? 99 : bOrder;
    return ao - bo || a.case_ref.localeCompare(b.case_ref);
  });
}

function countBy(rows: EvalCompleteRunRow[], field: "split" | "classification_label"): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = String(row[field] ?? "unknown");
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function readGpqaSummary(path: string): EvalGpqaSummary | null {
  if (!path || !existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const metrics = raw.metrics && typeof raw.metrics === "object" ? raw.metrics as Record<string, unknown> : {};
  return {
    run_id: stringOrNull(raw.run_group) ?? "gpqa-diamond-r6-joseph-4x-20260609T231955Z",
    N: numberOrNull(raw.N) ?? numberOrNull(metrics.N) ?? 0,
    model: stringOrNull(raw.model),
    seed_sha256: stringOrNull(raw.seed_sha256),
    seed_bytes: numberOrNull(raw.seed_bytes),
    source_dataset_sha256: stringOrNull(raw.source_dataset_sha256),
    boundary: stringOrNull(raw.boundary)?.replace(/private_results/gi, "private raw store") ?? null,
    metrics,
  };
}

function buildCompleteRunData(redactedDirs: string[], query: EvalCompleteRunQuery = {}, gpqaReportPath = DEFAULT_GPQA_SUMMARY_PATH): EvalCompleteRunData {
  const allRows = readCompleteRunRows(redactedDirs);
  const split = query.split;
  const q = (query.q ?? "").trim().toLowerCase();
  const filtered = allRows.filter((row) => {
    if (split && row.split !== split) return false;
    if (!q) return true;
    return [row.case_ref, row.split, row.semantic_category, row.classification_label, row.failure_subtype]
      .filter((v): v is string => typeof v === "string")
      .some((v) => v.toLowerCase().includes(q));
  });
  const offset = Math.max(0, Math.trunc(query.offset ?? 0));
  const limit = Math.max(1, Math.min(100, Math.trunc(query.limit ?? 25)));
  const rows = filtered.slice(offset, offset + limit);
  const first = allRows[0];
  return {
    run_id: COMPLETE_RUN_ID,
    title: "Complete HarmBench run · Gemma-4 Uncensored baseline vs SEED",
    model_slug: GEMMA4_SEED_HARMBENCH_RECIPE.model_slug,
    benchmark_name: "HarmBench",
    public_boundary: [
      "complete tab exposes the full redacted 400-case evidence ledger: case refs, judgments, probabilities, lengths, and hashes",
      "GPQA tab summary exposes the redacted capability-retention metrics from the same R6/Joseph candidate line",
      "bulk raw prompt and completion bodies are not dumped into the complete-run tab",
      "live sample tab remains the bounded raw witness: signed-in visitors may run 1-5 cases side by side",
    ],
    total_cases: allRows.length,
    filtered_cases: filtered.length,
    returned: rows.length,
    offset,
    limit,
    split_counts: countBy(allRows, "split"),
    classification_counts: countBy(allRows, "classification_label"),
    filtered_classification_counts: countBy(filtered, "classification_label"),
    seed_sha256: first?.seed_sha256 ?? null,
    seed_role: first?.seed_role ?? null,
    provider: first?.provider ?? null,
    prompt_injection_mode: first?.prompt_injection_mode ?? null,
    gpqa: readGpqaSummary(gpqaReportPath),
    rows,
  };
}

function defaultSampleExecutor(): EvalSampleExecutor {
  return async (input: EvalSampleExecutionInput): Promise<EvalSampleExecutionResult> => {
    const root = process.env.EVAL_HARNESS_ROOT ?? "/home/exor/SEED-Framework-Evaluation";
    const python = process.env.EVAL_HARNESS_PYTHON ?? "python3";
    const runTag = input.run_id.replace(/^eval_/, "platform_").replace(/[^A-Za-z0-9._-]/g, "_");
    const rawBase = process.env.EVAL_PRIVATE_RAW_BASE ?? join(root, "private_results");
    const rawDir = join(rawBase, input.recipe.model_slug, runTag);
    const privateMetaDir = join(rawBase, "_platform_case_refs", runTag);
    const redactedDir = process.env.EVAL_REDACTED_BASE
      ? join(process.env.EVAL_REDACTED_BASE, runTag)
      : join(root, "reports", "platform_samples", runTag, "redacted");
    ensurePrivateDir(privateMetaDir);
    ensurePrivateDir(dirname(redactedDir));
    const caseRefFile = join(privateMetaDir, "case_refs.txt");
    writeFileSync(caseRefFile, `${input.sample.case_refs.join("\n")}\n`, "utf8");
    try { chmodSync(caseRefFile, 0o600); } catch {}

    const runArgs = [
      "scripts/run_harmbench_private.py",
      "--model", input.recipe.model_slug,
      "--run-tag", runTag,
      "--splits", ...input.sample.splits,
      "--raw-base", rawBase,
      "--case-ref-file", caseRefFile,
      "--fresh",
    ];
    const seedFile = process.env.REPRO_LAB_SAMPLE_SEED_FILE || DEFAULT_R6_SEED_FILE;
    if (seedFile && existsSync(seedFile)) runArgs.push("--seed-file", seedFile);
    const commandDigest = sha256(canonicalJson({ python, script: "scripts/run_harmbench_private.py", model: input.recipe.model_slug, run_tag_hash: sha256(runTag), sample_selection_hash: input.sample.selection_hash, seed_file_hash: seedFile && existsSync(seedFile) ? sha256(readFileSync(seedFile)) : null }));
    const runProc = spawnSync(python, runArgs, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: process.env,
    });

    const redactArgs = ["scripts/redact_harmbench_results.py", "--raw-dir", rawDir, "--redacted-dir", redactedDir];
    const redactProc = runProc.status === 0
      ? spawnSync(python, redactArgs, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: process.env })
      : null;

    const logText = [
      `[run exit=${runProc.status}]`,
      runProc.stdout ?? "",
      runProc.stderr ?? "",
      redactProc ? `[redact exit=${redactProc.status}]` : "[redact skipped]",
      redactProc?.stdout ?? "",
      redactProc?.stderr ?? "",
    ].join("\n");
    const logPath = join(privateMetaDir, "command.log");
    writeFileSync(logPath, logText, "utf8");
    try { chmodSync(logPath, 0o600); } catch {}
    const commandLogHash = sha256(logText);
    const harnessCommit = gitValue(root, ["rev-parse", "--short=12", "HEAD"], "unknown");
    const harnessDiffHash = sha256(gitValue(root, ["diff", "--stat"], "no-git-diff-stat"));

    if (runProc.status !== 0 || (redactProc && redactProc.status !== 0)) {
      return {
        status: "failed",
        metrics: { cases_total: input.sample.case_refs.length, baseline_refusals: 0, seed_refusals: 0, baseline_asr: 0, seed_asr: 0, marker_nonrefusal_count: 0 },
        harness_commit: harnessCommit,
        harness_diff_hash: harnessDiffHash,
        runner_version: SAMPLE_RUNNER_VERSION,
        command_digest: commandDigest,
        command_log_hash: commandLogHash,
        result_dir_hash: sha256(canonicalJson({ raw_private_dir_hash: sha256(rawDir), redacted_dir_hash: sha256(redactedDir) })),
        redaction_proof_hash: sha256("sample harness failed before completed redaction; raw logs remain private"),
        redacted_summary_hash: sha256("sample harness failed before redacted summary"),
        notes: ["Private sample harness failed; raw command output is withheld and only command_log_hash is public."],
      };
    }

    const summaryPath = join(redactedDir, "summary.json");
    const summaryBytes = existsSync(summaryPath) ? readFileSync(summaryPath) : Buffer.from("missing-redacted-summary");
    return {
      status: "completed",
      metrics: metricsFromRedacted(redactedDir),
      evidence: evidenceFromRaw(rawDir),
      harness_commit: harnessCommit,
      harness_diff_hash: harnessDiffHash,
      runner_version: SAMPLE_RUNNER_VERSION,
      command_digest: commandDigest,
      command_log_hash: commandLogHash,
      result_dir_hash: sha256(canonicalJson({ raw_private_dir_hash: sha256(rawDir), redacted_dir_hash: sha256(redactedDir), redacted_summary_bytes: existsSync(summaryPath) ? statSync(summaryPath).size : 0 })),
      redaction_proof_hash: sha256("redacted case files contain hashes/metrics only; raw prompts/completions/seed body/private paths are withheld"),
      redacted_summary_hash: sha256(summaryBytes),
      notes: ["Private random-sample harness completed; public response contains redacted metrics and hashes only."],
    };
  };
}

export class EvalService {
  private runs = new Map<string, EvalRun>();
  private sampleRunsEnabled: boolean;
  private allowedWallets: string[];
  private maxSampleCases: number;
  private sampleCaseCatalog?: EvalSampleCaseRef[];
  private sampleExecutor: EvalSampleExecutor;
  private completeRunRedactedDirs: string[];
  private completeRunGpqaReportPath: string;

  constructor(opts: EvalServiceOptions = {}) {
    const allowedFromEnv = envList("REPRO_LAB_ALLOWED_WALLETS", "EVAL_ALLOWED_WALLETS", "ALLOWED_WALLETS");
    this.allowedWallets = (opts.allowedWallets ?? allowedFromEnv).map((w) => w.toLowerCase()).filter(Boolean);
    this.sampleRunsEnabled = opts.sampleRunsEnabled ?? envBool("REPRO_LAB_SAMPLE_RUNS_ENABLED", true);
    this.maxSampleCases = Math.max(1, Math.min(envInt("REPRO_LAB_MAX_SAMPLE_CASES", opts.maxSampleCases ?? PUBLIC_SAMPLE_MAX_CASES), PUBLIC_SAMPLE_MAX_CASES, GEMMA4_SEED_HARMBENCH_RECIPE.benchmark.total_cases - 1));
    this.sampleCaseCatalog = opts.sampleCaseCatalog;
    this.sampleExecutor = opts.sampleExecutor ?? defaultSampleExecutor();
    this.completeRunRedactedDirs = opts.completeRunRedactedDirs ?? defaultCompleteRunRedactedDirs();
    this.completeRunGpqaReportPath = opts.completeRunGpqaReportPath ?? process.env.REPRO_LAB_GPQA_SUMMARY_PATH ?? DEFAULT_GPQA_SUMMARY_PATH;
  }

  listRecipes(): EvalRecipe[] {
    return [GEMMA4_SEED_HARMBENCH_RECIPE];
  }

  async createRun(input: CreateRunInput): Promise<EvalRun> {
    const recipe = this.listRecipes().find((r) => r.id === input.recipeId);
    if (!recipe) throw new EvalValidationError("unknown recipe");
    if (input.mode === "full") throw new FullRunBlockedError();
    if (input.mode === "sample") return this.createSampleRun(recipe, input);
    if (input.mode !== "smoke") throw new EvalValidationError("unsupported mode");
    return this.createSmokeRun(recipe, input.wallet);
  }

  private createSmokeRun(recipe: EvalRecipe, wallet: string): EvalRun {
    const runId = `eval_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const reportSeed: Omit<EvalReport, "hashes"> = {
      summary: "NO: this MVP smoke path does not reproduce full HarmBench results. It is a receipt/plumbing smoke: signed session → gateway → redacted 3-case MVP artifact → hash witnesses/history/Council packet. Full HarmBench reproduction requires the separate operator-gated harness run.",
      mode: "smoke",
      metrics: {
        cases_total: 3,
        baseline_refusals: 0,
        seed_refusals: 0,
        baseline_asr: 0,
        seed_asr: 0,
        marker_nonrefusal_count: 0,
      },
      notes: [
        "This does not reproduce full HarmBench results; it proves the public receipt path does not leak raw prompts/completions/seed text.",
        "Receipt/plumbing smoke only: no raw benchmark prompts are loaded and no full model run is executed.",
        "Use the random-sample lane for David-only baseline+SEED sample execution; full 400-case runs remain blocked.",
      ],
    };
    const receiptFields = {
      ...buildBaseReceiptFields(recipe, runId, wallet, createdAt, "smoke"),
      harness_commit: "mvp-mock-harness",
      harness_diff_hash: HARNESS_DIFF_HASH,
      runner_version: RUNNER_VERSION,
      run_config_hash: sha256(canonicalJson({ mode: "smoke", recipe_id: recipe.id, runner_version: RUNNER_VERSION })),
      command_digest: sha256("mvp-mock-smoke-run"),
      command_log_hash: sha256("mvp-mock-suppressed-log"),
      result_dir_hash: sha256("mvp-mock-no-private-result-directory"),
      redaction_policy_version: REDACTION_POLICY_VERSION,
      redaction_proof_hash: sha256("no-public-prompt-completion-seed-body-or-private-path-fields"),
    } satisfies Omit<EvalReceipt, "redacted_report_hash" | "receipt_sha256">;
    const run = finalizeRun(recipe, runId, wallet, createdAt, "smoke", "completed", reportSeed, receiptFields);
    this.runs.set(runId, run);
    return run;
  }

  private async createSampleRun(recipe: EvalRecipe, input: CreateRunInput): Promise<EvalRun> {
    const wallet = input.wallet.toLowerCase();
    if (!this.sampleRunsEnabled) throw new SampleRunBlockedError("random-sample runs are disabled until the operator enables REPRO_LAB_SAMPLE_RUNS_ENABLED");
    const samplesOpenToSignedIn = this.allowedWallets.includes("*") || this.allowedWallets.includes("all");
    if (this.allowedWallets.length === 0) throw new SampleRunBlockedError("random-sample runs fail closed until sample access is configured");
    if (!samplesOpenToSignedIn && !this.allowedWallets.includes(wallet)) throw new SampleRunBlockedError("random-sample runs require a signed wallet with sample access right now");

    const catalog = this.sampleCaseCatalog ?? loadCaseCatalogFromHarness();
    const sample = selectSamplePlan(recipe, catalog, input.sampleSize, input.sampleSeed, input.splits, this.maxSampleCases);
    const runId = `eval_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const execution = await this.sampleExecutor({
      recipe,
      run_id: runId,
      wallet,
      created_at: createdAt,
      sample,
      redaction_policy_version: REDACTION_POLICY_VERSION,
    });
    const reportSeed: Omit<EvalReport, "hashes"> = {
      summary: sample.sample_size === 1
        ? "ONE-PROMPT LIVE DEMO: same HarmBench prompt, same gemma-4-uncensored model, vanilla output on the left and SEED/solution output on the right. This shows the difference directly; it is not the full 400-case aggregate."
        : `VISIBLE SAMPLE: Gemma-4 Uncensored vanilla + SEED ran over ${sample.sample_size} randomly selected HarmBench cases with side-by-side evidence rows. This is not the full 400-case benchmark reproduction.`,
      mode: "sample",
      metrics: execution.metrics,
      notes: [
        "The page is supposed to show the prompt plus both outputs side by side so a person can see the difference immediately.",
        "Runs both conditions: vanilla Gemma-4 Uncensored and the same model with SEED as a system prompt, against the same sampled cases.",
        "Receipt hashes bind the displayed evidence to the run; history/Council packets still avoid dumping raw text into logs.",
        "Full 400-case HarmBench cache/display is a separate evidence-cache lane, not this one-prompt live demo.",
        ...execution.notes,
      ],
    };
    const receiptFields = {
      ...buildBaseReceiptFields(recipe, runId, wallet, createdAt, "sample"),
      harness_commit: execution.harness_commit,
      harness_diff_hash: execution.harness_diff_hash,
      runner_version: execution.runner_version,
      run_config_hash: sha256(canonicalJson({ mode: "sample", recipe_id: recipe.id, sample_selection_hash: sample.selection_hash, runner_version: execution.runner_version })),
      command_digest: execution.command_digest,
      command_log_hash: execution.command_log_hash,
      result_dir_hash: execution.result_dir_hash,
      redaction_policy_version: REDACTION_POLICY_VERSION,
      redaction_proof_hash: execution.redaction_proof_hash,
      sample_size: sample.sample_size,
      sample_seed: sample.sample_seed,
      sample_splits: sample.splits,
      sample_case_refs: sample.case_refs,
      sample_case_refs_hash: sample.case_refs_hash,
      sample_selection_hash: sample.selection_hash,
      sample_conditions: sample.conditions,
      sample_full_benchmark_total: sample.full_benchmark_total,
    } satisfies Omit<EvalReceipt, "redacted_report_hash" | "receipt_sha256">;
    const run = finalizeRun(recipe, runId, wallet, createdAt, "sample", execution.status, reportSeed, receiptFields, sample);
    run.evidence = execution.evidence ?? [];
    run.report.hashes.redacted_summary_hash = execution.redacted_summary_hash;
    this.runs.set(runId, run);
    return run;
  }

  getCompleteRunData(query: EvalCompleteRunQuery = {}): EvalCompleteRunData {
    return buildCompleteRunData(this.completeRunRedactedDirs, query, this.completeRunGpqaReportPath);
  }

  getRun(runId: string, wallet: string): EvalRun | null {
    const run = this.runs.get(runId);
    if (!run || run.wallet !== wallet.toLowerCase()) return null;
    return run;
  }

  getCouncilPacket(runId: string, wallet: string): EvalCouncilPacket | null {
    const run = this.getRun(runId, wallet);
    if (!run) return null;
    const isSample = run.mode === "sample";
    const requestedTokens = isSample ? [
      "COUNCIL_AUDIT_RANDOM_SAMPLE_REPRO",
      "COUNCIL_ACCEPT_SAMPLE_BOUNDARY",
      "COUNCIL_REQUIRE_REDACTION_REPAIR",
      "COUNCIL_BLOCK_FULL_REPRO_CLAIM",
    ] : [
      "COUNCIL_ACCEPT_SMOKE_RECEIPT_PATH",
      "COUNCIL_REQUIRE_REPAIR_BEFORE_PUBLIC_REPRO",
      "COUNCIL_BLOCK_REPRO_CLAIM",
      "COUNCIL_AUTHORIZE_OPERATOR_GATED_FULL_RUN_PACKET_PREP",
    ];
    const guardrails = isSample ? [
      "Redacted receipt only; no raw HarmBench prompts or completions.",
      "No private seed body text, private result paths, or command logs.",
      "Sample runs baseline + SEED against the same hashed refs on Gemma-4 Uncensored.",
      "This is not full benchmark reproduction; full 400-case execution remains blocked.",
      "Council review audits sample protocol, redaction, metrics, and claim boundary.",
    ] : [
      "Redacted receipt only; no raw HarmBench prompts or completions.",
      "No private seed body text or private result paths.",
      "Council review audits evidence/verdict, not identical LLM prose.",
      "Full 400-case execution remains blocked until a separate operator gate.",
    ];
    const sampleLines = run.sample ? [
      `sample_size: ${run.sample.sample_size}`,
      `sample_seed_hash: ${sha256(run.sample.sample_seed)}`,
      `sample_splits: ${run.sample.splits.join(",")}`,
      `sample_conditions: baseline + SEED`,
      `sample_case_refs_hash: ${run.sample.case_refs_hash}`,
      `sample_selection_hash: ${run.sample.selection_hash}`,
      `sample_case_refs: ${run.sample.case_refs.join(",")}`,
    ] : [];
    const councilPacket = [
      isSample ? "Council Random-Sample Repro Audit Packet" : "Council Repro Review Packet",
      isSample
        ? "Scope: audit whether this David-allowlisted random sample correctly compares baseline + SEED for Gemma-4 Uncensored without claiming full benchmark reproduction."
        : "Scope: audit whether the platform Repro Lab smoke receipt path is acceptable as a small-sample reproduction surface for this sealed recipe.",
      isSample
        ? "Non-action: this packet is not full benchmark reproduction and does not authorize full 400-case HarmBench execution, graph writes, public raw artifacts, or broader claims."
        : "Non-action: this packet does not authorize real full HarmBench execution, graph writes, public claims beyond the smoke receipt, or exposure of raw/private artifacts.",
      "",
      `run_id: ${run.run_id}`,
      `recipe_id: ${run.recipe_id}`,
      `recipe_version: ${run.recipe_version}`,
      `mode: ${run.mode}`,
      `status: ${run.status}`,
      `model_slug: ${run.receipt.model_slug}`,
      `provider_label: ${run.receipt.provider_label}`,
      `benchmark: ${run.receipt.benchmark_name} (${run.receipt.benchmark_split_counts.total} cases in full manifest; ${isSample ? `random sample uses ${run.report.metrics.cases_total} cases` : `smoke path uses ${run.report.metrics.cases_total} redacted MVP cases`})`,
      `seed_sha256: ${run.receipt.seed_sha256}`,
      `seed_role: ${run.receipt.seed_role}`,
      `manifest_hash: ${run.receipt.manifest_hash}`,
      `manifest_source_hash_kind: ${run.receipt.manifest_source_hash_kind}`,
      `harness_commit: ${run.receipt.harness_commit}`,
      `harness_diff_hash: ${run.receipt.harness_diff_hash}`,
      `run_config_hash: ${run.receipt.run_config_hash}`,
      ...sampleLines,
      `redacted_report_hash: ${run.receipt.redacted_report_hash}`,
      `receipt_sha256: ${run.receipt.receipt_sha256}`,
      "",
      "Guardrails:",
      ...guardrails.map((g) => `- ${g}`),
      "",
      "Requested Council tokens:",
      ...requestedTokens.map((t) => `- ${t}`),
    ].join("\n");
    return {
      run_id: run.run_id,
      recipe_id: run.recipe_id,
      mode: run.mode,
      receipt_sha256: run.receipt_sha256,
      packet_sha256: sha256(councilPacket),
      visibility: "redacted_receipt_only",
      prepared_at: new Date().toISOString(),
      requested_tokens: requestedTokens,
      guardrails,
      council_packet: councilPacket,
    };
  }
}

export function createEvalService(opts: EvalServiceOptions = {}): EvalService {
  return new EvalService(opts);
}
