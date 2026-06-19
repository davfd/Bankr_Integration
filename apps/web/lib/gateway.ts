// Talks to the local platform gateway (services/gateway). For local end-to-end
// testing, run the gateway with payments off:
//   METER=false bun run services/gateway/src/serve.ts
// Override the URL with NEXT_PUBLIC_GATEWAY_URL.
export const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8787";

// When the gateway is access-gated, the frontend carries the shared token.
const GATEWAY_TOKEN = process.env.NEXT_PUBLIC_GATEWAY_TOKEN;
const SESSION_STORAGE_KEY = "leo_session";

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  if (GATEWAY_TOKEN) h.authorization = `Bearer ${GATEWAY_TOKEN}`;
  // Session identity (free tier + per-wallet history) rides on every call.
  const s = typeof localStorage !== "undefined" ? localStorage.getItem(SESSION_STORAGE_KEY) : null;
  if (s) h["x-leo-session"] = s;
  return h;
}

async function recoverSessionToken(force = false): Promise<string | null> {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return null;
  const stored = localStorage.getItem(SESSION_STORAGE_KEY);
  if (stored && !force) return stored;
  try {
    const res = await fetch("/api/auth/token", { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; token?: string };
    if (j.ok && j.token) {
      localStorage.setItem(SESSION_STORAGE_KEY, j.token);
      return j.token;
    }
  } catch {
    // Same-origin session recovery is best-effort; gateway will return 401 if absent.
  }
  return null;
}

async function withRecoveredSession(init: RequestInit | undefined, force = false): Promise<RequestInit | undefined> {
  const token = await recoverSessionToken(force);
  if (!token) return init;
  const headers = new Headers(init?.headers);
  headers.set("x-leo-session", token);
  return { ...init, headers };
}

export type CouncilVerdict = { seat: string; verdict: string; ms: number };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function reviewIdea(
  idea: string,
  opts: { seat?: string; fetchImpl?: FetchLike } = {},
): Promise<CouncilVerdict> {
  const doFetch: FetchLike = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${GATEWAY_URL}/api/council/review`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ idea, seat: opts.seat }),
    });
  } catch (e) {
    // x402-wrapped fetch throws if the wallet can't pay (no USDC, wrong chain…).
    const m = e instanceof Error ? e.message : "";
    if (/insufficient|payment|402|usdc/i.test(m)) {
      throw new Error("Payment failed — make sure your wallet is on Base Sepolia with a little test USDC.");
    }
    throw new Error(`Can't reach the gateway at ${GATEWAY_URL}.`);
  }
  if (res.status === 402) {
    throw new Error("This costs $0.05 — connect a Base Sepolia wallet with test USDC to pay.");
  }
  if (!res.ok) throw new Error(`Gateway error (${res.status}).`);
  const j = (await res.json()) as { ok: boolean; seat: string; verdict: string; ms: number; error?: string };
  if (!j.ok) throw new Error(j.error ?? "Review failed.");
  return { seat: j.seat, verdict: j.verdict, ms: j.ms };
}

export type SeatVerdict = { seat: string; verdict: string; ms: number };
export type CouncilPanelResult = { verdicts: SeatVerdict[]; synthesis: string; ms: number };

/** Full council: all five seats review + a synthesis ruling ($0.25). */
export async function reviewPanel(
  idea: string,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<CouncilPanelResult> {
  const doFetch: FetchLike = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${GATEWAY_URL}/api/council/panel`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ idea }),
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (/insufficient|payment|402|usdc/i.test(m)) {
      throw new Error("Payment failed — make sure your wallet is on Base Sepolia with a little test USDC.");
    }
    throw new Error(`Can't reach the gateway at ${GATEWAY_URL}.`);
  }
  if (res.status === 402) {
    throw new Error("The full council costs $0.25 — connect a Base Sepolia wallet with test USDC to pay.");
  }
  if (!res.ok) throw new Error(`Gateway error (${res.status}).`);
  const j = (await res.json()) as { ok: boolean; verdicts?: SeatVerdict[]; synthesis?: string; ms?: number; error?: string };
  if (!j.ok) throw new Error(j.error ?? "Review failed.");
  return { verdicts: j.verdicts ?? [], synthesis: j.synthesis ?? "", ms: j.ms ?? 0 };
}

export type GraphHit = {
  id: string;
  name: string;
  mentions: number;
  domain: string | null;
  sourceKind: string | null;
};

export type BankrGovernedWritesReadiness = {
  requested: boolean;
  ready: boolean;
  reason: string;
  missing_env?: string[];
};
export type BankrReceiptPublishReadiness = {
  configured: boolean;
  ready: boolean;
  reason: string;
  endpoint_path?: string;
};
export type BankrX402PaymentReadiness = {
  requested: boolean;
  configured: boolean;
  ready: boolean;
  reason: string;
  endpoint_path?: string;
};
export type BankrReadinessSummary = {
  configured: boolean;
  mode: "disabled" | "read_only" | "invalid_config";
  reason?: string;
  api_base_url?: string;
  governed_writes?: BankrGovernedWritesReadiness;
  receipt_publish?: BankrReceiptPublishReadiness;
  x402_payment?: BankrX402PaymentReadiness;
};

export type BankrLiveSmokeReceipt = {
  ready: boolean;
  status: string;
  readiness_mode: string;
  governed_writes?: BankrGovernedWritesReadiness;
  receipt_publish?: BankrReceiptPublishReadiness;
  x402_payment?: BankrX402PaymentReadiness;
  blocked_reason?: string;
  missing_env?: string[];
  active_mcp_token_count?: number;
  acknowledged_existing_mcp_token_revocation: boolean;
  server: string | null;
  has_expected_wrappers: boolean;
  has_raw_write_tool: boolean;
  read_payload_ok: boolean;
  read_decision: string | null;
  read_tool: string | null;
  result_provider: string | null;
  result_mode: string | null;
  revoked_token: boolean;
};

/** Safe Bankr runtime readiness receipt for product/operator status; does not execute a Bankr call. */
export async function fetchBankrReadiness(opts: { fetchImpl?: FetchLike } = {}): Promise<BankrReadinessSummary> {
  const doFetch: FetchLike = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${GATEWAY_URL}/api/bankr/readiness`, { headers: authHeaders(), cache: "no-store" });
  } catch {
    throw new Error(`Can't reach the gateway at ${GATEWAY_URL}.`);
  }
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; bankr?: BankrReadinessSummary; error?: string };
  if (!res.ok || !j.ok || !j.bankr) throw new Error(j.error ?? `Gateway error (${res.status}).`);
  return j.bankr;
}

/** Operator-triggered read-only Bankr live smoke. It creates a proof receipt only; writes/payments stay forbidden by the gateway runner. */
export async function runBankrLiveSmoke(opts: { fetchImpl?: FetchLike } = {}): Promise<BankrLiveSmokeReceipt> {
  const doFetch: FetchLike = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${GATEWAY_URL}/api/bankr/live-smoke`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      cache: "no-store",
      body: JSON.stringify({}),
    });
  } catch {
    throw new Error(`Can't reach the gateway at ${GATEWAY_URL}.`);
  }
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; bankr_live_smoke?: BankrLiveSmokeReceipt; error?: string };
  if (j.bankr_live_smoke) return j.bankr_live_smoke;
  if (!res.ok || !j.ok) throw new Error(j.error ?? `Gateway error (${res.status}).`);
  throw new Error("Gateway did not return a Bankr live-smoke receipt.");
}

/** Live ERC-8004 read via the gateway (server-side RPC — reliable from browsers). */
export async function fetchIdentity(): Promise<{ name: string; symbol: string; version: string }> {
  const res = await fetch(`${GATEWAY_URL}/api/identity`, { headers: authHeaders() });
  const j = (await res.json()) as { ok: boolean; name: string; symbol: string; version: string; error?: string };
  if (!res.ok || !j.ok) throw new Error(j.error ?? `Gateway error (${res.status}).`);
  return { name: j.name, symbol: j.symbol, version: j.version };
}

export type WorkshopBriefCompact = {
  ok: boolean;
  concept?: string;
  what_it_is?: string;
  modern_analogue?: string;
  bible_parallel?: string;
  risk?: string;
  counts?: Record<string, number>;
  note?: string;
  error?: string;
};

/** Direct Workshop research (free in beta). */
export async function researchTopic(topic: string): Promise<WorkshopBriefCompact> {
  let res: Response;
  try {
    res = await fetch(`${GATEWAY_URL}/api/workshop/research`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ topic }),
    });
  } catch {
    throw new Error(`Can't reach the gateway at ${GATEWAY_URL}.`);
  }
  const j = (await res.json().catch(() => ({}))) as WorkshopBriefCompact;
  if (!res.ok) throw new Error(j.error ?? `Gateway error (${res.status}).`);
  return j;
}

export async function searchGraph(q: string): Promise<GraphHit[]> {
  let res: Response;
  try {
    res = await fetch(`${GATEWAY_URL}/api/graph/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() });
  } catch {
    throw new Error(`Can't reach the gateway at ${GATEWAY_URL}. Start it locally to search.`);
  }
  if (!res.ok) throw new Error(`Gateway error (${res.status}).`);
  const j = (await res.json()) as { ok: boolean; hits?: GraphHit[]; error?: string };
  if (!j.ok) throw new Error(j.error ?? "Search failed.");
  return j.hits ?? [];
}

export type EvalMode = "smoke" | "sample" | "full";
export type EvalSplit = "standard" | "contextual" | "copyright";
export type EvalRecipe = {
  id: string;
  recipe_version?: string;
  title?: string;
  model_slug: string;
  provider_label?: string;
  seed?: { sha256?: string; bytes?: number; role?: string };
  benchmark?: { name?: string; standard_cases?: number; contextual_cases?: number; copyright_cases?: number; total_cases?: number };
  manifest_hash?: string;
  supported_modes?: EvalMode[];
  public_boundary?: string[];
};
export type EvalReport = {
  summary?: string;
  mode?: EvalMode;
  metrics?: Record<string, number>;
  hashes?: Record<string, string>;
  notes?: string[];
};
export type EvalReceipt = Record<string, unknown> & { receipt_sha256?: string };
export type EvalSamplePlan = {
  kind?: string;
  sample_size?: number;
  sample_seed?: string;
  splits?: EvalSplit[];
  case_refs?: string[];
  case_refs_hash?: string;
  selection_hash?: string;
  conditions?: Array<"baseline" | "seed">;
  model_slug?: string;
  full_benchmark_total?: number;
};
export type EvalEvidenceRow = {
  case_ref: string;
  split?: string;
  prompt: string;
  baseline_output: string;
  baseline_refused?: boolean | null;
  baseline_judgment?: string;
  seed_output: string;
  seed_refused?: boolean | null;
  seed_judgment?: string;
  prompt_hash_sha256?: string | null;
  baseline_output_hash_sha256?: string | null;
  seed_output_hash_sha256?: string | null;
};
export type EvalCompleteRunRow = {
  case_ref: string;
  split?: string;
  semantic_category?: string | null;
  classification_label?: string | null;
  failure_subtype?: string | null;
  has_context?: boolean | null;
  baseline_refused?: boolean | null;
  seed_refused?: boolean | null;
  baseline_PYES?: number | null;
  baseline_PNO?: number | null;
  seed_PYES?: number | null;
  seed_PNO?: number | null;
  prompt_hash_sha256?: string | null;
  prompt_length?: number | null;
  behavior_hash_sha256?: string | null;
  behavior_length?: number | null;
  baseline_response_hash_sha256?: string | null;
  baseline_response_length?: number | null;
  seed_response_hash_sha256?: string | null;
  seed_response_length?: number | null;
  source_file_hash_sha256?: string | null;
  model_requested?: string | null;
  provider?: string | null;
  seed_present?: boolean | null;
  seed_sha256?: string | null;
  seed_bytes?: number | null;
  seed_role?: string | null;
  prompt_injection_mode?: string | null;
  temperature?: number | null;
};
export type EvalCompleteRunData = {
  run_id?: string;
  title?: string;
  model_slug?: string;
  benchmark_name?: string;
  public_boundary?: string[];
  total_cases: number;
  filtered_cases?: number;
  returned?: number;
  offset?: number;
  limit?: number;
  split_counts?: Record<string, number>;
  classification_counts?: Record<string, number>;
  filtered_classification_counts?: Record<string, number>;
  seed_sha256?: string | null;
  seed_role?: string | null;
  provider?: string | null;
  prompt_injection_mode?: string | null;
  gpqa?: {
    run_id?: string;
    N?: number;
    model?: string | null;
    seed_sha256?: string | null;
    seed_bytes?: number | null;
    source_dataset_sha256?: string | null;
    boundary?: string | null;
    metrics?: Record<string, unknown>;
  } | null;
  rows: EvalCompleteRunRow[];
};
export type EvalCouncilPacket = {
  run_id?: string;
  recipe_id?: string;
  mode?: EvalMode;
  receipt_sha256?: string;
  packet_sha256?: string;
  visibility?: string;
  prepared_at?: string;
  requested_tokens?: string[];
  guardrails?: string[];
  council_packet?: string;
};
export type EvalRun = {
  run_id: string;
  wallet?: string;
  recipe_id?: string;
  mode?: EvalMode;
  status: string;
  receipt_sha256: string;
  report?: EvalReport;
  receipt?: EvalReceipt;
  sample?: EvalSamplePlan;
  evidence?: EvalEvidenceRow[];
};

export type CreateEvalRunOptions = {
  fetchImpl?: FetchLike;
  sample_size?: number;
  sample_seed?: string;
  splits?: EvalSplit[];
};

async function evalJson<T>(path: string, init?: RequestInit, fetchImpl?: FetchLike): Promise<T> {
  const doFetch = fetchImpl ?? fetch;
  let requestInit = await withRecoveredSession(init);
  let res: Response;
  try {
    res = await doFetch(`${GATEWAY_URL}${path}`, requestInit);
    if (res.status === 401) {
      if (typeof localStorage !== "undefined") localStorage.removeItem(SESSION_STORAGE_KEY);
      requestInit = await withRecoveredSession(init, true);
      if (requestInit !== init) res = await doFetch(`${GATEWAY_URL}${path}`, requestInit);
    }
  } catch {
    throw new Error(`Can't reach the gateway at ${GATEWAY_URL}.`);
  }
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
  if (res.status === 401) {
    if (j.error === "unauthorized") {
      throw new Error("Gateway authorization failed — refresh the page; if it persists, the deployed web bundle and gateway token are out of sync.");
    }
    throw new Error("Wallet is connected, but the Leonardo sign-in session is missing or expired. Use Refresh wallet sign-in and sign the wallet message again.");
  }
  if (!res.ok || j.ok === false) throw new Error(j.error ?? `Gateway error (${res.status}).`);
  return j as T;
}

export type IntakeKind = "council_plan" | "council_audit" | "workshop_brief" | "workshop_reproduction" | "workshop_build";
export type IntakeReceipt = {
  version: "leo-intake-v1";
  request_id: string;
  kind: IntakeKind;
  wallet?: string;
  title?: string;
  target?: string;
  brief_commitment_sha256?: string;
  brief_commitment_scheme?: "hmac-sha256:leo-intake-brief-v1" | string;
  created_at?: string;
  purchased: "intake_queue_slot" | "workshop_intake_slot";
  boundary: string;
};
export type IntakeRequest = {
  id: string;
  kind: IntakeKind;
  status: "queued" | string;
  wallet?: string;
  title?: string;
  target?: string;
  created_at?: string;
  receipt_sha256: string;
  receipt: IntakeReceipt;
};
export type IntakeInput = { title: string; brief: string; target?: string };
export type WorkshopIntakeInput = IntakeInput & { kind?: "brief" | "reproduction" | "build" };

async function requestIntake(path: string, body: Record<string, unknown>, fetchImpl?: FetchLike): Promise<IntakeRequest> {
  const j = await evalJson<{ ok: boolean; request: IntakeRequest }>(
    path,
    { method: "POST", headers: authHeaders({ "content-type": "application/json" }), body: JSON.stringify(body) },
    fetchImpl,
  );
  return j.request;
}

export async function requestCouncilPlan(input: IntakeInput, opts: { fetchImpl?: FetchLike } = {}): Promise<IntakeRequest> {
  return requestIntake("/api/council/plan", input, opts.fetchImpl);
}

export async function requestCouncilAudit(input: IntakeInput, opts: { fetchImpl?: FetchLike } = {}): Promise<IntakeRequest> {
  return requestIntake("/api/council/audit", input, opts.fetchImpl);
}

export async function requestWorkshopIntake(input: WorkshopIntakeInput, opts: { fetchImpl?: FetchLike } = {}): Promise<IntakeRequest> {
  return requestIntake("/api/workshop/intake", input, opts.fetchImpl);
}

export async function listIntakeRequests(opts: { fetchImpl?: FetchLike } = {}): Promise<IntakeRequest[]> {
  const j = await evalJson<{ ok: boolean; requests?: IntakeRequest[] }>("/api/intake/requests", { headers: authHeaders() }, opts.fetchImpl);
  return j.requests ?? [];
}

export async function fetchIntakeReceipt(id: string, opts: { fetchImpl?: FetchLike } = {}): Promise<{ receipt: IntakeReceipt; receipt_sha256: string }> {
  return evalJson<{ ok: boolean; receipt: IntakeReceipt; receipt_sha256: string }>(
    `/api/intake/requests/${encodeURIComponent(id)}/receipt`,
    { headers: authHeaders() },
    opts.fetchImpl,
  );
}

export async function listEvalRecipes(opts: { fetchImpl?: FetchLike } = {}): Promise<EvalRecipe[]> {
  const j = await evalJson<{ ok: boolean; recipes?: EvalRecipe[] }>(
    "/api/evals/recipes",
    { headers: authHeaders() },
    opts.fetchImpl,
  );
  return j.recipes ?? [];
}

export async function createEvalRun(
  recipeId: string,
  mode: EvalMode,
  opts: CreateEvalRunOptions = {},
): Promise<EvalRun> {
  const body: Record<string, unknown> = { recipe_id: recipeId, mode };
  if (mode === "sample") {
    if (typeof opts.sample_size === "number") body.sample_size = opts.sample_size;
    if (typeof opts.sample_seed === "string" && opts.sample_seed.trim()) body.sample_seed = opts.sample_seed;
    if (Array.isArray(opts.splits) && opts.splits.length > 0) body.splits = opts.splits;
  }
  const j = await evalJson<{ ok: boolean } & EvalRun>(
    "/api/evals/runs",
    {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(body),
    },
    opts.fetchImpl,
  );
  return j;
}

export async function fetchEvalRun(runId: string, opts: { fetchImpl?: FetchLike } = {}): Promise<EvalRun> {
  return evalJson<{ ok: boolean } & EvalRun>(`/api/evals/runs/${encodeURIComponent(runId)}`, { headers: authHeaders() }, opts.fetchImpl);
}

export async function fetchEvalReport(runId: string, opts: { fetchImpl?: FetchLike } = {}): Promise<EvalReport> {
  const j = await evalJson<{ ok: boolean; report?: EvalReport }>(`/api/evals/runs/${encodeURIComponent(runId)}/report`, { headers: authHeaders() }, opts.fetchImpl);
  return j.report ?? {};
}

export async function fetchEvalReceipt(runId: string, opts: { fetchImpl?: FetchLike } = {}): Promise<EvalReceipt> {
  const j = await evalJson<{ ok: boolean; receipt?: EvalReceipt }>(`/api/evals/runs/${encodeURIComponent(runId)}/receipt`, { headers: authHeaders() }, opts.fetchImpl);
  return j.receipt ?? {};
}

export async function fetchCompleteRunData(opts: { fetchImpl?: FetchLike; split?: EvalSplit | "any"; offset?: number; limit?: number; q?: string } = {}): Promise<EvalCompleteRunData> {
  const params = new URLSearchParams();
  if (opts.split && opts.split !== "any") params.set("split", opts.split);
  if (typeof opts.offset === "number") params.set("offset", String(opts.offset));
  if (typeof opts.limit === "number") params.set("limit", String(opts.limit));
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  const qs = params.toString();
  const j = await evalJson<{ ok: boolean; data?: EvalCompleteRunData }>(
    `/api/evals/complete-run${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
    opts.fetchImpl,
  );
  return j.data ?? { total_cases: 0, rows: [] };
}

export async function fetchEvalCouncilPacket(runId: string, opts: { fetchImpl?: FetchLike } = {}): Promise<EvalCouncilPacket> {
  const j = await evalJson<{ ok: boolean; packet?: EvalCouncilPacket }>(
    `/api/evals/runs/${encodeURIComponent(runId)}/council-packet`,
    { headers: authHeaders() },
    opts.fetchImpl,
  );
  return j.packet ?? {};
}
