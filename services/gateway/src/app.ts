import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { paymentMiddleware } from "x402-hono";
import { readRegistry, IDENTITY_REGISTRY } from "./identity";
import { realCouncilReview, realCouncilPanel, type CouncilReviewer, type CouncilPanelReviewer } from "./council";
import { realGraphSearch, type GraphSearcher } from "./graph";
import { safeEqual, corsOrigin, rateLimit, securityHeaders, decodeX402Payer } from "./security";
import { runChatTurn, type AnthropicLike } from "./chat/agent";
import { runHermesTurn } from "./chat/hermes-acp";
import { loadIdentity, buildPreamble, recordTurn, oneLineSummary } from "./chat/identity";
import { encodeFrame, HEARTBEAT, type ChatFrame } from "./chat/frames";
import { logUsage as defaultLogUsage, type UsageLogger } from "./chat/usage";
import { verifySessionToken, freeRemaining, consumeFree } from "./chat/freebies";
import {
  provisionAgent,
  agentStatus,
  promptAgent,
  requestAutonomousSpend,
  type PromptExec,
} from "./agents/runner";
import { IntegrityError } from "@leonardo/shared";
import {
  appendHistory,
  listHistory,
  listConversations,
  getConversation,
  putConversation,
  deleteConversation,
} from "./history";
import { recordCouncil, searchCouncilMemory } from "./council-memory";
import { createEvalService, EvalValidationError, FullRunBlockedError, SampleRunBlockedError, type EvalCompleteRunQuery, type EvalService, type EvalSplit } from "./evals";
import { DEFAULT_MCP_TOKEN_EXPIRY_DAYS, createMcpToken, listMcpTokens, revokeMcpToken, rotateMcpToken, verifyMcpToken } from "./mcp-tokens";
import { graphMcpRequiredScope, graphMcpToolName, handleGraphMcpRequest } from "./mcp-graph";
import { BASE_MCP_SCOPE, baseMcpToolName, handleBaseMcpRequest, type BaseMcpApprovalStore, type BaseMcpRuntime, type CapabilityGrant } from "./mcp-base";
import { assertIntakeReady, createIntakeRequest, getIntakeRequest, listIntakeRequests, IntakeValidationError, type IntakeKind } from "./intake";
import { evaluateContext, evaluateOutput, evaluatePrompt, evaluateToolCall, explainRefusal, writeReceipt, type IdentityEnvelope, type IdentityVerdict, type Receipt } from "@leonardo/identity-kernel";
import { runIdentityKernelGatedTurn, type IdentityKernelModel, type IdentityKernelRuntime } from "./identity-kernel-gate";
import { safeBankrReceiptJson, type BankrReadinessReceipt } from "./bankr-readiness";
import { safeBankrLiveSmokeJson, type BankrLiveSmokeReceipt } from "./bankr-live-smoke";

// Input caps — bound LLM cost + DB load and reject abusive payloads.
const MAX_IDEA_LEN = 4000;
const MAX_QUERY_LEN = 128;
const SEAT_RE = /^[a-z][a-z0-9_-]{0,32}$/; // also excludes __proto__ etc.

export type ResolvedAgentPassport = {
  agent_id: string;
  passport_id: string;
  active_system_prompt_hash: string;
  authority_scope: string[];
  risk_context?: string;
  capability_grants?: CapabilityGrant[];
};

export type IdentityKernelHarnessOptions = {
  /** Registers the isolated /api/identity-kernel/harness route when true. */
  enabled?: true;
  /** Applies passport-bound Identity Kernel admission/release checks to /api/chat when true. */
  enforceChat?: boolean;
  resolvePassport: (input: { wallet: string; passport_id: string }) => Promise<ResolvedAgentPassport | null> | ResolvedAgentPassport | null;
  model?: IdentityKernelModel;
  tools?: Record<string, (args: unknown) => Promise<unknown> | unknown>;
  kernel?: IdentityKernelRuntime;
};

export type GatewayOptions = {
  payTo?: `0x${string}`;
  /** Inject a Council reviewer (tests pass a mock; default runs the real seats). */
  councilReview?: CouncilReviewer;
  /** Inject the full-panel reviewer (5 seats + synthesis); default is real. */
  councilPanel?: CouncilPanelReviewer;
  /** Inject a graph searcher (tests pass a mock; default queries Neo4j :7687). */
  graphSearch?: GraphSearcher;
  /** Apply the x402 paywall to metered routes (default true; tests can disable). */
  meter?: boolean;
  /** Inject the chat model client (tests pass a scripted mock; default = real SDK). */
  anthropic?: AnthropicLike;
  /** Chat model id (default from CHAT_MODEL env). */
  chatModel?: string;
  /** Inject the usage logger (tests pass a recorder). */
  logUsage?: UsageLogger;
  /** Inject the hosted-agent prompt executor (tests mock; default = hermes). */
  agentExec?: PromptExec;
  /** Inject/override eval run storage (tests can pass an isolated service). */
  evalService?: EvalService;
  /** Opt-in, isolated Identity Kernel route harness for passport-bound integration tests. Disabled by default. */
  identityKernelHarness?: IdentityKernelHarnessOptions;
  /** Inject governed Base MCP runtime functions (tests/prod adapters). Default is safe policy-only/dry-run behavior. */
  baseMcpRuntime?: BaseMcpRuntime;
  /** Inject sealed human-approved contract operations for governed Bankr submit. Undefined = fail-closed for execute_approved_contract_operation. */
  baseMcpApprovalStore?: BaseMcpApprovalStore;
  /** Safe, precomputed Bankr runtime readiness receipt for product/status surfaces. */
  bankrReadiness?: BankrReadinessReceipt;
  /** Explicit operator-enabled runner for read-only Bankr live-smoke receipts. Undefined keeps the route fail-closed. */
  bankrLiveSmokeRunner?: () => Promise<BankrLiveSmokeReceipt>;
};

type ChatIdentityKernelState = {
  envelope: IdentityEnvelope;
  kernel: IdentityKernelRuntime;
  receipts: Receipt[];
};

type IdentityKernelFrame = {
  type: "identity_kernel";
  enforced: true;
  agent_id: string;
  passport_id: string;
  receipts: Receipt[];
};

function isBlockingIdentityVerdict(verdict: IdentityVerdict): boolean {
  return verdict.verdict === "refuse" || verdict.verdict === "require_human" || verdict.verdict === "ask_clarifying";
}

function identityKernelFrame(state: ChatIdentityKernelState, receipts: Receipt[]): IdentityKernelFrame {
  return {
    type: "identity_kernel",
    enforced: true,
    agent_id: state.envelope.agent_id,
    passport_id: state.envelope.passport_id,
    receipts,
  };
}

function disabledBankrLiveSmokeReceipt(readiness?: BankrReadinessReceipt): BankrLiveSmokeReceipt {
  return {
    ready: false,
    status: "blocked_missing_config",
    readiness_mode: readiness?.mode ?? "disabled",
    governed_writes: readiness?.governed_writes,
    receipt_publish: readiness?.receipt_publish,
    x402_payment: readiness?.x402_payment,
    blocked_reason: "Bankr live smoke route disabled",
    missing_env: [],
    acknowledged_existing_mcp_token_revocation: false,
    server: null,
    has_expected_wrappers: false,
    has_raw_write_tool: false,
    read_payload_ok: false,
    read_decision: null,
    read_tool: null,
    result_provider: null,
    result_mode: null,
    revoked_token: false,
  };
}

function enforceBankrLiveSmokeWitnessFloor(receipt: BankrLiveSmokeReceipt): BankrLiveSmokeReceipt {
  const claimsPass = receipt.status === "pass" && receipt.ready === true;
  if (!claimsPass) return receipt;
  const activeMcpTokenCount = receipt.active_mcp_token_count;
  if (typeof activeMcpTokenCount === "number") {
    if (Number.isInteger(activeMcpTokenCount) && activeMcpTokenCount >= 0) return receipt;
  }
  return {
    ...receipt,
    ready: false,
    status: "fail",
    blocked_reason: "active_mcp_token_count missing from Bankr live-smoke receipt",
  };
}

function requestedToolsFromBody(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((tool): tool is string => typeof tool === "string" && tool.trim().length > 0).map((tool) => tool.trim())
    : [];
}

function receiptFor(envelope: IdentityEnvelope, verdict: IdentityVerdict, stage: string): Receipt {
  return writeReceipt(envelope, verdict, stage);
}

function identityKernelRuntime(runtime?: IdentityKernelRuntime): IdentityKernelRuntime {
  return runtime ?? { evaluatePrompt, evaluateContext, evaluateToolCall, evaluateOutput };
}

/**
 * The platform gateway: the real functions behind the dashboard tiles.
 *  - GET  /health               — liveness (free)
 *  - GET  /api/identity         — live ERC-8004 read on Base (free)
 *  - POST /api/council/review   — run the Council on an idea (metered via x402)
 */
export function createGatewayApp(opts: GatewayOptions = {}): Hono {
  const councilReview = opts.councilReview ?? realCouncilReview;
  const councilPanel = opts.councilPanel ?? realCouncilPanel;
  const graphSearch = opts.graphSearch ?? realGraphSearch;
  const payTo = opts.payTo ?? "0x0000000000000000000000000000000000000001";
  const meter = opts.meter ?? true;
  const brainKind = process.env.CHAT_BRAIN ?? "codex";
  const chatModel =
    opts.chatModel ??
    process.env.CHAT_MODEL ??
    (brainKind === "openai" ? process.env.CHAT_OPENAI_MODEL ?? "gpt-5.4-mini" : "claude-opus-4-8");
  const logUsage = opts.logUsage ?? defaultLogUsage;
  const evalService = opts.evalService ?? createEvalService();
  const identityKernelHarness = opts.identityKernelHarness;
  // Chat brain, lazily constructed (tests inject a mock). Default = the Hermes
  // rail: the local `codex` CLI on its subscription auth. CHAT_BRAIN=anthropic
  // switches to the Anthropic API (needs ANTHROPIC_API_KEY) for per-token billing.
  let brain: AnthropicLike | undefined = opts.anthropic;
  async function getBrain(): Promise<AnthropicLike> {
    if (brain) return brain;
    if (brainKind === "anthropic") {
      if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      brain = new Anthropic() as unknown as AnthropicLike;
    } else if (brainKind === "openai") {
      if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
      const { openaiClient } = await import("./chat/openai");
      brain = openaiClient();
    } else {
      const { codexClient } = await import("./chat/codex");
      brain = codexClient();
    }
    return brain;
  }

  const app = new Hono();

  // Never leak internals on an unexpected throw.
  app.onError((_err, c) => c.json({ ok: false, error: "internal error" }, 500));

  // Hardening headers on every response.
  app.use("*", securityHeaders);

  // CORS: strict allowlist (localhost + *.vercel.app + GATEWAY_ALLOWED_ORIGINS),
  // not a reflect-everything wildcard.
  app.use(
    "*",
    cors({
      origin: corsOrigin,
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Payment", "X-Leo-Session"],
      maxAge: 600,
    }),
  );

  // Per-IP rate limit, before auth — also throttles token-guessing.
  app.use("*", rateLimit());

  // Access gate: when GATEWAY_TOKEN is set, every route except /health requires a
  // matching Bearer token. Constant-time compare; no query-string token (which
  // would leak via access logs / browser history). Locks the gateway to our frontend.
  const token = process.env.GATEWAY_TOKEN;
  if (token) {
    app.use("*", async (c, next) => {
      if (c.req.path === "/health" || c.req.path.startsWith("/mcp/graph") || c.req.path.startsWith("/mcp/base")) return next();
      const auth = c.req.header("authorization");
      const provided = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!provided || !safeEqual(provided, token)) {
        return c.json({ ok: false, error: "unauthorized" }, 401);
      }
      return next();
    });
  }

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/api/bankr/readiness", (c) => {
    const receipt = opts.bankrReadiness ?? {
      configured: false,
      mode: "disabled",
      reason: "Bankr readiness not installed on this gateway",
    } satisfies BankrReadinessReceipt;
    return c.json({ ok: true, bankr: JSON.parse(safeBankrReceiptJson(receipt)) });
  });

  app.post("/api/bankr/live-smoke", async (c) => {
    if (!opts.bankrLiveSmokeRunner) {
      const receipt = disabledBankrLiveSmokeReceipt(opts.bankrReadiness);
      return c.json({ ok: false, error: "bankr live smoke route disabled", bankr_live_smoke: JSON.parse(safeBankrLiveSmokeJson(receipt)) }, 403);
    }
    const receipt = await opts.bankrLiveSmokeRunner();
    const safeReceipt = enforceBankrLiveSmokeWitnessFloor(JSON.parse(safeBankrLiveSmokeJson(receipt)) as BankrLiveSmokeReceipt);
    const ok = safeReceipt.status === "pass" && safeReceipt.ready === true;
    return c.json({ ok, bankr_live_smoke: safeReceipt }, ok ? 200 : 409);
  });

  const requireSession = (c: { req: { header: (n: string) => string | undefined } }) =>
    verifySessionToken(c.req.header("x-leo-session"));

  // Intake POSTs are user-account actions before they are paid actions. Check the
  // signed wallet session before x402 middleware can challenge/settle payment, so
  // an expired or missing session is never asked to authorize money first.
  const sessionFirstIntakePaths = new Set(["/api/council/plan", "/api/council/audit", "/api/workshop/intake"]);
  app.use("*", async (c, next) => {
    if (c.req.method === "POST" && sessionFirstIntakePaths.has(c.req.path)) {
      const wallet = requireSession(c);
      if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
      try {
        assertIntakeReady(wallet);
      } catch {
        return c.json({ ok: false, error: "intake unavailable" }, 503);
      }
    }
    return next();
  });

  app.get("/api/identity", async (c) => {
    try {
      const info = await readRegistry();
      return c.json({ ok: true, registry: IDENTITY_REGISTRY, ...info });
    } catch {
      return c.json({ ok: false, error: "registry unreachable" }, 502);
    }
  });

  if (identityKernelHarness?.enabled) {
    app.post("/api/identity-kernel/harness", async (c) => {
      const wallet = requireSession(c);
      if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);

      const body = (await c.req.json().catch(() => ({}))) as {
        passport_id?: unknown;
        request?: unknown;
        requested_tools?: unknown;
        context?: unknown;
      };
      const passportId = typeof body.passport_id === "string" ? body.passport_id.trim() : "";
      const request = typeof body.request === "string" ? body.request.trim() : "";
      if (!passportId || !request) return c.json({ ok: false, error: "passport_id and request required" }, 400);
      if (request.length > MAX_IDEA_LEN) return c.json({ ok: false, error: "request too long" }, 413);

      const passport = await identityKernelHarness.resolvePassport({ wallet, passport_id: passportId });
      if (!passport || passport.passport_id !== passportId) {
        return c.json({ ok: false, error: "passport not linked to session wallet" }, 403);
      }

      const requestedTools = Array.isArray(body.requested_tools)
        ? body.requested_tools.filter((tool): tool is string => typeof tool === "string" && tool.trim().length > 0).map((tool) => tool.trim())
        : [];
      const context = Array.isArray(body.context)
        ? body.context.flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const record = item as { kind?: unknown; text?: unknown };
            if (typeof record.text !== "string") return [];
            return [{ kind: typeof record.kind === "string" ? record.kind : "retrieved_document", text: record.text }];
          })
        : [];

      const envelope: IdentityEnvelope = {
        agent_id: passport.agent_id,
        passport_id: passport.passport_id,
        user_request: request,
        active_system_prompt_hash: passport.active_system_prompt_hash,
        authority_scope: passport.authority_scope,
        requested_tools: requestedTools,
        memory_refs: context.filter((item) => item.kind === "memory").map((item, index) => `memory:${index}:${item.text.length}`),
        risk_context: passport.risk_context ?? "public_chat",
      };

      const result = await runIdentityKernelGatedTurn({
        envelope,
        context,
        kernel: identityKernelHarness.kernel ?? { evaluatePrompt, evaluateContext, evaluateToolCall, evaluateOutput },
        model: identityKernelHarness.model ?? (async ({ context }) => ({ text: `identity_kernel_harness_model_context_count:${context.length}` })),
        tools: identityKernelHarness.tools,
      });

      return c.json({ ok: true, agent_id: envelope.agent_id, passport_id: envelope.passport_id, ...result });
    });
  }

  // Search the imagination graph (free read).
  app.get("/api/graph/search", async (c) => {
    const q = (c.req.query("q") ?? "").slice(0, MAX_QUERY_LEN);
    if (q.trim().length < 2) return c.json({ ok: true, hits: [] });
    try {
      return c.json({ ok: true, hits: await graphSearch(q) });
    } catch {
      return c.json({ ok: false, error: "graph unavailable" }, 502);
    }
  });

  // Imagination Graph MCP developer tokens. These are wallet-session managed,
  // shown once, hash-only at rest, and scoped to read-only graph access.
  app.get("/api/mcp/tokens", (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    return c.json({ ok: true, tokens: listMcpTokens(wallet) });
  });

  app.post("/api/mcp/tokens", async (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { label?: unknown; scopes?: unknown; expiresInDays?: unknown };
    const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s): s is string => typeof s === "string") : undefined;
    const expiresInDays = typeof body.expiresInDays === "number" && Number.isFinite(body.expiresInDays) ? body.expiresInDays : DEFAULT_MCP_TOKEN_EXPIRY_DAYS;
    try {
      const out = createMcpToken({ wallet, label: typeof body.label === "string" ? body.label : undefined, scopes, expiresInDays });
      logUsage({ wallet, kind: "mcp_token_create", units: 1 });
      return c.json({ ok: true, ...out });
    } catch {
      return c.json({ ok: false, error: "invalid token request" }, 400);
    }
  });

  app.delete("/api/mcp/tokens/:id", (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    const ok = revokeMcpToken(wallet, c.req.param("id"));
    if (!ok) return c.json({ ok: false, error: "not found" }, 404);
    return c.json({ ok: true });
  });

  app.post("/api/mcp/tokens/:id/rotate", (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    const out = rotateMcpToken(wallet, c.req.param("id"));
    if (!out) return c.json({ ok: false, error: "not found" }, 404);
    return c.json({ ok: true, ...out });
  });

  app.get("/mcp/graph/health", (c) => {
    const auth = c.req.header("authorization");
    const tokenValue = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
    const verified = verifyMcpToken(tokenValue, ["graph:read", "scripture:read", "council_memory:read"], "health");
    if (!verified.ok) return c.json({ ok: false, error: "unauthorized" }, verified.code === "insufficient_scope" ? 403 : 401);
    return c.json({ ok: true, server: "leonardo-graph" });
  });

  app.post("/mcp/graph", async (c) => {
    const auth = c.req.header("authorization");
    const tokenValue = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
    const raw = await c.req.text().catch(() => "");
    if (raw.length > 64_000) return c.json({ ok: false, error: "request too large" }, 413);
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
    }
    const toolName = graphMcpToolName(body) ?? "mcp";
    if (toolName === "__invalid_tool_name__") {
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32602, message: "invalid tool name" } }, 400);
    }
    const requiredScope = graphMcpRequiredScope(body);
    const verified = verifyMcpToken(tokenValue, requiredScope, toolName);
    if (!verified.ok) {
      return c.json(
        { jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } },
        verified.code === "insufficient_scope" ? 403 : 401,
      );
    }
    const out = await handleGraphMcpRequest(body, { graphSearch, councilSearch: searchCouncilMemory, sidecarUrl: process.env.WORKSHOP_SIDECAR_URL });
    if (out === null) return c.body(null, 202);
    return c.json(out);
  });

  function baseMcpBearer(c: Context): string | undefined {
    const auth = c.req.header("authorization");
    return auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
  }

  function baseMcpPassportId(body: unknown): string {
    if (!body || typeof body !== "object") return "";
    const req = body as { method?: unknown; params?: unknown };
    if (req.method !== "tools/call" || !req.params || typeof req.params !== "object") return "";
    const args = (req.params as Record<string, unknown>).arguments;
    if (!args || typeof args !== "object") return "";
    const passportId = (args as Record<string, unknown>).passport_id;
    return typeof passportId === "string" ? passportId.trim() : "";
  }

  app.get("/mcp/base/health", (c) => {
    const verified = verifyMcpToken(baseMcpBearer(c), BASE_MCP_SCOPE, "health");
    if (!verified.ok) return c.json({ ok: false, error: "unauthorized" }, verified.code === "insufficient_scope" ? 403 : 401);
    return c.json({ ok: true, server: "leonardo-base-identity-kernel", guarded: true });
  });

  app.post("/mcp/base", async (c) => {
    const raw = await c.req.text().catch(() => "");
    if (raw.length > 64_000) return c.json({ ok: false, error: "request too large" }, 413);
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
    }

    const toolName = baseMcpToolName(body) ?? "mcp";
    if (toolName === "__invalid_tool_name__") {
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32602, message: "invalid tool name" } }, 400);
    }

    const verified = verifyMcpToken(baseMcpBearer(c), BASE_MCP_SCOPE, toolName);
    if (!verified.ok) {
      return c.json(
        { jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } },
        verified.code === "insufficient_scope" ? 403 : 401,
      );
    }

    const req = body && typeof body === "object" ? (body as { id?: unknown; method?: unknown }) : {};
    const id = (typeof req.id === "string" || typeof req.id === "number" || req.id === null) ? req.id : null;
    if (req.method === "tools/call") {
      const passportId = baseMcpPassportId(body);
      if (!passportId) return c.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "passport_id required" } }, 400);
      if (!identityKernelHarness?.resolvePassport) {
        return c.json({ jsonrpc: "2.0", id, error: { code: -32002, message: "identity kernel passport resolver unavailable" } }, 503);
      }
      const passport = await identityKernelHarness.resolvePassport({ wallet: verified.record.wallet, passport_id: passportId });
      if (!passport || passport.passport_id !== passportId) {
        return c.json({ jsonrpc: "2.0", id, error: { code: -32001, message: "passport not linked to token wallet" } }, 403);
      }
      const out = await handleBaseMcpRequest(body, { session: { wallet: verified.record.wallet, passport }, runtime: opts.baseMcpRuntime, approvalStore: opts.baseMcpApprovalStore });
      if (out === null) return c.body(null, 202);
      logUsage({ wallet: verified.record.wallet, kind: "base_mcp", units: 1 });
      return c.json(out);
    }

    const out = await handleBaseMcpRequest(body);
    if (out === null) return c.body(null, 202);
    return c.json(out);
  });

  // Payer allowlist (the "only my wallet" lock): when GATEWAY_PAYER_ALLOWLIST is
  // set, reject any x402 payment whose payer isn't on it — before settlement, so
  // a disallowed wallet is never charged. Unset = open pay-to-use.
  const payerAllowlist = (process.env.GATEWAY_PAYER_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (payerAllowlist.length > 0) {
    app.use("*", async (c, next) => {
      const payer = decodeX402Payer(c.req.header("x-payment"));
      if (payer && !payerAllowlist.includes(payer)) {
        return c.json({ ok: false, error: "this wallet is not allowed to pay" }, 403);
      }
      return next();
    });
  }

  // Metered surface: each Council review costs $0.05 on Base Sepolia via x402.
  // The facilitator verifies + settles the USDC payment — so this is real
  // pay-to-use, not just a 402 challenge. x402.org is a free public testnet
  // facilitator (no API keys); swap for Coinbase's on mainnet.
  if (meter) {
    const facilitator = {
      url: (process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator") as `${string}://${string}`,
    };
    app.use(
      paymentMiddleware(
        payTo,
        {
          "/api/council/review": { price: "$0.05", network: "base-sepolia" },
          "/api/council/panel": { price: "$0.25", network: "base-sepolia" },
          "/api/council/plan": { price: process.env.COUNCIL_PLAN_PRICE ?? "$0.25", network: "base-sepolia" },
          "/api/council/audit": { price: process.env.COUNCIL_AUDIT_PRICE ?? "$0.25", network: "base-sepolia" },
          "/api/workshop/intake": { price: process.env.WORKSHOP_INTAKE_PRICE ?? "$0.25", network: "base-sepolia" },
        },
        facilitator,
      ),
    );
    // Chat free tier: a signed-in wallet (valid session token) gets FREE_PROMPTS
    // messages before the paywall kicks in. No session / no freebies left → the
    // normal x402 402-challenge → pay flow.
    const chatPaywall = paymentMiddleware(
      payTo,
      { "/api/chat": { price: process.env.CHAT_PRICE ?? "$0.02", network: "base-sepolia" } },
      facilitator,
    );
    app.use("/api/chat", async (c, next) => {
      const wallet = verifySessionToken(c.req.header("x-leo-session"));
      if (wallet && !c.req.header("x-payment") && freeRemaining(wallet) > 0) {
        return next(); // freebie — consumed in the handler once the turn starts
      }
      return chatPaywall(c, next);
    });
  }

  app.post("/api/council/review", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { idea?: string; seat?: string };
    const idea = (body.idea ?? "").trim();
    if (!idea) return c.json({ ok: false, error: "idea required" }, 400);
    if (idea.length > MAX_IDEA_LEN) {
      return c.json({ ok: false, error: `idea too long (max ${MAX_IDEA_LEN} chars)` }, 413);
    }
    const seat = body.seat && SEAT_RE.test(body.seat) ? body.seat : undefined;
    try {
      const out = await councilReview({ idea, seat });
      const w = decodeX402Payer(c.req.header("x-payment")) ?? verifySessionToken(c.req.header("x-leo-session"));
      logUsage({ wallet: w ?? "anonymous", kind: "council", units: 1 });
      if (w) try { appendHistory(w, { kind: "council", q: idea, a: `[${out.seat}] ${out.verdict}` }); } catch {}
      // Capture into council memory (full text, searchable by the chat tool).
      try { recordCouncil({ wallet: w, idea, mode: "quick", verdicts: [{ seat: out.seat, verdict: out.verdict }] }); } catch {}
      return c.json({ ok: true, ...out });
    } catch {
      return c.json({ ok: false, error: "review failed" }, 502);
    }
  });

  // Full council: all seats review + a synthesis ruling ($0.25).
  app.post("/api/council/panel", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { idea?: string };
    const idea = (body.idea ?? "").trim();
    if (!idea) return c.json({ ok: false, error: "idea required" }, 400);
    if (idea.length > MAX_IDEA_LEN) {
      return c.json({ ok: false, error: `idea too long (max ${MAX_IDEA_LEN} chars)` }, 413);
    }
    try {
      const out = await councilPanel({ idea });
      const w = decodeX402Payer(c.req.header("x-payment")) ?? verifySessionToken(c.req.header("x-leo-session"));
      logUsage({ wallet: w ?? "anonymous", kind: "council_panel", units: 1 });
      if (w) try { appendHistory(w, { kind: "council", q: idea, a: `[panel ruling] ${out.synthesis}` }); } catch {}
      // Capture the full panel into council memory (searchable by the chat tool).
      try { recordCouncil({ wallet: w, idea, mode: "panel", verdicts: out.verdicts, synthesis: out.synthesis }); } catch {}
      return c.json({ ok: true, ...out });
    } catch {
      return c.json({ ok: false, error: "review failed" }, 502);
    }
  });

  async function enqueueIntake(c: Context, kind: IntakeKind) {
    const wallet = verifySessionToken(c.req.header("x-leo-session"));
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { title?: unknown; brief?: unknown; target?: unknown; artifact_url?: unknown; url?: unknown };
    try {
      const request = createIntakeRequest({
        wallet,
        kind,
        title: body.title,
        brief: body.brief,
        target: body.target ?? body.artifact_url ?? body.url,
      });
      logUsage({ wallet, kind: `${kind}_intake`, units: 1 });
      try {
        appendHistory(wallet, {
          kind: "intake",
          q: `${request.kind}: ${request.title}`,
          a: `queued receipt=${request.receipt_sha256}; ${request.receipt.boundary}`,
        });
      } catch {
        // history is best-effort; receipt creation already succeeded.
      }
      return c.json({ ok: true, request }, 202);
    } catch (e) {
      if (e instanceof IntakeValidationError) return c.json({ ok: false, error: "title and brief required" }, 400);
      return c.json({ ok: false, error: "intake unavailable" }, 503);
    }
  }

  app.post("/api/council/plan", (c) => enqueueIntake(c, "council_plan"));
  app.post("/api/council/audit", (c) => enqueueIntake(c, "council_audit"));
  app.post("/api/workshop/intake", async (c) => {
    const raw = (await c.req.json().catch(() => ({}))) as { kind?: unknown; title?: unknown; brief?: unknown; target?: unknown; artifact_url?: unknown; url?: unknown };
    const subkind = raw.kind === "build" ? "workshop_build" : raw.kind === "reproduction" ? "workshop_reproduction" : raw.kind === "brief" || !raw.kind ? "workshop_brief" : null;
    if (!subkind) return c.json({ ok: false, error: "kind must be brief, reproduction, or build" }, 400);
    const wallet = verifySessionToken(c.req.header("x-leo-session"));
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    try {
      const request = createIntakeRequest({
        wallet,
        kind: subkind,
        title: raw.title,
        brief: raw.brief,
        target: raw.target ?? raw.artifact_url ?? raw.url,
      });
      logUsage({ wallet, kind: `${subkind}_intake`, units: 1 });
      try {
        appendHistory(wallet, {
          kind: "intake",
          q: `${request.kind}: ${request.title}`,
          a: `queued receipt=${request.receipt_sha256}; ${request.receipt.boundary}`,
        });
      } catch {}
      return c.json({ ok: true, request }, 202);
    } catch (e) {
      if (e instanceof IntakeValidationError) return c.json({ ok: false, error: "title and brief required" }, 400);
      return c.json({ ok: false, error: "intake unavailable" }, 503);
    }
  });

  app.get("/api/intake/requests", (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    return c.json({ ok: true, requests: listIntakeRequests(wallet) });
  });

  app.get("/api/intake/requests/:id/receipt", (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    const request = getIntakeRequest(wallet, c.req.param("id"));
    if (!request) return c.json({ ok: false, error: "not found" }, 404);
    return c.json({ ok: true, receipt: request.receipt, receipt_sha256: request.receipt_sha256 });
  });

  // Hosted Agent (beta slice): one isolated Hermes instance per signed-in wallet.
  // All routes require the signed web session — the wallet IS the tenant id.

  // Repro Lab (MVP): sealed eval recipes + deterministic redacted smoke receipts.
  // Real HarmBench execution is deliberately blocked here; raw prompts/completions
  // never enter public responses or platform history.
  app.get("/api/evals/recipes", (c) => c.json({ ok: true, recipes: evalService.listRecipes() }));

  app.get("/api/evals/complete-run", (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    const splitRaw = c.req.query("split");
    const split = splitRaw === "standard" || splitRaw === "contextual" || splitRaw === "copyright" ? splitRaw : undefined;
    const offsetRaw = Number(c.req.query("offset") ?? 0);
    const limitRaw = Number(c.req.query("limit") ?? 25);
    const query: EvalCompleteRunQuery = {
      split,
      offset: Number.isFinite(offsetRaw) ? offsetRaw : 0,
      limit: Number.isFinite(limitRaw) ? limitRaw : 25,
      q: c.req.query("q") ?? undefined,
    };
    return c.json({ ok: true, data: evalService.getCompleteRunData(query) });
  });

  app.post("/api/evals/runs", async (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { recipe_id?: string; mode?: string; sample_size?: unknown; sample_seed?: unknown; splits?: unknown };
    const recipeId = (body.recipe_id ?? "").trim();
    const mode = body.mode === "full" ? "full" : body.mode === "sample" ? "sample" : body.mode === "smoke" ? "smoke" : null;
    const sampleSize = typeof body.sample_size === "number" ? body.sample_size : typeof body.sample_size === "string" && body.sample_size.trim() ? Number(body.sample_size) : undefined;
    const sampleSeed = typeof body.sample_seed === "string" ? body.sample_seed : undefined;
    const splits = Array.isArray(body.splits) ? body.splits.filter((s): s is EvalSplit => s === "standard" || s === "contextual" || s === "copyright") : undefined;
    if (!recipeId || !mode) return c.json({ ok: false, error: "recipe_id and mode required" }, 400);
    try {
      const run = await evalService.createRun({ recipeId, mode, wallet, sampleSize, sampleSeed, splits });
      logUsage({ wallet, kind: run.mode === "sample" ? "eval_sample" : "eval_smoke", units: 1 });
      try {
        appendHistory(wallet, {
          kind: "repro",
          q: `repro ${run.mode} · ${run.recipe_id} · ${run.run_id}`,
          a: `status=${run.status} receipt=${run.receipt_sha256} manifest=${run.receipt.manifest_hash} seed=${run.receipt.seed_sha256}${run.sample ? ` sample=${run.sample.sample_size} selection=${run.sample.selection_hash}` : ""}`,
        });
      } catch {
        // history is best-effort; never put raw eval material here.
      }
      return c.json({ ok: true, ...run });
    } catch (e) {
      if (e instanceof FullRunBlockedError || e instanceof SampleRunBlockedError) return c.json({ ok: false, error: e.message }, 403);
      if (e instanceof EvalValidationError) return c.json({ ok: false, error: e.message }, 400);
      return c.json({ ok: false, error: "eval run failed" }, 400);
    }
  });

  app.get("/api/evals/runs/:id/report", (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    const run = evalService.getRun(c.req.param("id"), wallet);
    if (!run) return c.json({ ok: false, error: "not found" }, 404);
    return c.json({ ok: true, run_id: run.run_id, report: run.report });
  });

  app.get("/api/evals/runs/:id/receipt", (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    const run = evalService.getRun(c.req.param("id"), wallet);
    if (!run) return c.json({ ok: false, error: "not found" }, 404);
    return c.json({ ok: true, run_id: run.run_id, receipt: run.receipt });
  });

  app.get("/api/evals/runs/:id/council-packet", (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    const packet = evalService.getCouncilPacket(c.req.param("id"), wallet);
    if (!packet) return c.json({ ok: false, error: "not found" }, 404);
    return c.json({ ok: true, run_id: packet.run_id, packet });
  });

  app.get("/api/evals/runs/:id", (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    const run = evalService.getRun(c.req.param("id"), wallet);
    if (!run) return c.json({ ok: false, error: "not found" }, 404);
    return c.json({ ok: true, ...run });
  });

  app.post("/api/agent/provision", async (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    try {
      const status = provisionAgent(wallet);
      logUsage({ wallet, kind: "agent_provision", units: 1 });
      return c.json({ ok: true, ...status });
    } catch {
      return c.json({ ok: false, error: "provisioning failed" }, 500);
    }
  });

  app.get("/api/agent/status", async (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    return c.json({ ok: true, ...agentStatus(wallet) });
  });

  app.post("/api/agent/prompt", async (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { prompt?: string };
    const prompt = (body.prompt ?? "").trim();
    if (!prompt) return c.json({ ok: false, error: "prompt required" }, 400);
    if (prompt.length > MAX_IDEA_LEN) return c.json({ ok: false, error: "prompt too long" }, 413);
    try {
      const out = await promptAgent(wallet, prompt, opts.agentExec);
      logUsage({ wallet, kind: "hosted_agent", units: 1 });
      try { appendHistory(wallet, { kind: "agent", q: prompt, a: out.reply }); } catch {}
      return c.json({ ok: true, ...out });
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      if (/not provisioned/.test(m)) return c.json({ ok: false, error: "agent not provisioned" }, 409);
      return c.json({ ok: false, error: "agent failed" }, 502);
    }
  });

  // The integrity gate, live: autonomous spend is structurally blocked until
  // Recognition Gateway (0003) + PledgeGate (0005) are hosted services.
  app.post("/api/agent/spend", async (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    try {
      requestAutonomousSpend(wallet, 1);
      return c.json({ ok: true }); // unreachable in beta
    } catch (e) {
      if (e instanceof IntegrityError) {
        return c.json({ ok: false, blocked: true, error: e.message }, 403);
      }
      return c.json({ ok: false, error: "spend request failed" }, 400);
    }
  });

  // Per-wallet activity history + saved conversations (session-gated).
  app.get("/api/history", async (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    const kind = c.req.query("kind") || undefined;
    return c.json({ ok: true, entries: listHistory(wallet, kind) });
  });

  app.post("/api/history", async (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { kind?: unknown; q?: unknown; a?: unknown };
    if (typeof body.kind !== "string" || typeof body.q !== "string") return c.json({ ok: false, error: "kind and q required" }, 400);
    const kind = body.kind.trim();
    if (!kind || !body.q.trim()) return c.json({ ok: false, error: "kind and q required" }, 400);
    if (kind === "repro") return c.json({ ok: false, error: "repro history is system-written only" }, 400);
    return c.json({ ok: true, entry: appendHistory(wallet, { kind, q: body.q, a: typeof body.a === "string" ? body.a : "" }) });
  });

  app.get("/api/conversations", async (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    return c.json({ ok: true, conversations: listConversations(wallet) });
  });

  app.get("/api/conversations/:id", async (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    const conv = getConversation(wallet, c.req.param("id"));
    if (!conv) return c.json({ ok: false, error: "not found" }, 404);
    return c.json({ ok: true, conversation: conv });
  });

  app.put("/api/conversations/:id", async (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    const raw = await c.req.text().catch(() => "");
    if (raw.length > 512_000) return c.json({ ok: false, error: "too large" }, 413);
    let body: { title?: string; items?: unknown[]; history?: unknown[]; summary?: string };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return c.json({ ok: false, error: "bad json" }, 400);
    }
    try {
      return c.json({ ok: true, meta: putConversation(wallet, c.req.param("id"), body) });
    } catch {
      return c.json({ ok: false, error: "save failed" }, 400);
    }
  });

  app.delete("/api/conversations/:id", async (c) => {
    const wallet = requireSession(c);
    if (!wallet) return c.json({ ok: false, error: "sign in first" }, 401);
    deleteConversation(wallet, c.req.param("id"));
    return c.json({ ok: true });
  });

  // The Workshop, direct (free in beta): research brief for a topic or canon id.
  app.post("/api/workshop/research", async (c) => {
    const sidecar = process.env.WORKSHOP_SIDECAR_URL;
    if (!sidecar) return c.json({ ok: false, error: "workshop not available yet" }, 503);
    const body = (await c.req.json().catch(() => ({}))) as { topic?: string; canon_id?: string };
    const topic = (body.topic ?? "").trim().slice(0, 200);
    const canonId = (body.canon_id ?? "").trim().slice(0, 80);
    if (!topic && !canonId) return c.json({ ok: false, error: "topic or canon_id required" }, 400);
    try {
      const res = await fetch(`${sidecar}/research`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(canonId ? { canon_id: canonId, include_semantic: false } : { topic, include_semantic: false }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) return c.json({ ok: false, error: "workshop unreachable" }, 502);
      const brief = (await res.json()) as { ok?: boolean; what_it_is?: string };
      const w = verifySessionToken(c.req.header("x-leo-session"));
      if (w && brief.ok) try { appendHistory(w, { kind: "workshop", q: topic || canonId, a: brief.what_it_is ?? "" }); } catch {}
      return c.json(brief);
    } catch {
      return c.json({ ok: false, error: "workshop unreachable" }, 502);
    }
  });

  // Leonardo chat: streaming SSE agent loop (priced per message via x402).
  // Free tools run inline; paid council tools end the turn with a
  // confirm_required frame and the client pays /api/council/* directly.
  app.post("/api/chat", async (c) => {
    const raw = await c.req.text().catch(() => "");
    if (raw.length > 64_000) return c.json({ ok: false, error: "request too large" }, 413);
    let body: { messages?: unknown; summary?: unknown; conversationId?: unknown; passport_id?: unknown; requested_tools?: unknown };
    try {
      body = JSON.parse(raw) as { messages?: unknown; summary?: unknown; conversationId?: unknown; passport_id?: unknown; requested_tools?: unknown };
    } catch {
      return c.json({ ok: false, error: "bad json" }, 400);
    }

    let priorSummary = typeof body.summary === "string" ? body.summary.slice(0, 4000) : undefined;
    const sessionWallet = verifySessionToken(c.req.header("x-leo-session"));
    const paidBy = decodeX402Payer(c.req.header("x-payment"));
    const payer = paidBy ?? sessionWallet ?? "anonymous";
    // A metered request that arrived without payment got here on a freebie.
    const freebie = meter && !paidBy && sessionWallet ? sessionWallet : null;
    const msgs = Array.isArray(body.messages) ? (body.messages as Array<{ role?: string; content?: unknown }>) : [];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user" && typeof m.content === "string");
    let chatIdentity: ChatIdentityKernelState | null = null;

    if (identityKernelHarness?.enforceChat) {
      if (!sessionWallet) return c.json({ ok: false, error: "sign in first" }, 401);
      const passportId = typeof body.passport_id === "string" ? body.passport_id.trim() : "";
      if (!passportId) return c.json({ ok: false, error: "passport_id required" }, 400);
      const request = typeof lastUser?.content === "string" ? lastUser.content.trim() : "";
      if (!request) return c.json({ ok: false, error: "chat message required" }, 400);

      const passport = await identityKernelHarness.resolvePassport({ wallet: sessionWallet, passport_id: passportId });
      if (!passport || passport.passport_id !== passportId) {
        return c.json({ ok: false, error: "passport not linked to session wallet" }, 403);
      }

      const kernel = identityKernelRuntime(identityKernelHarness.kernel);
      const envelope: IdentityEnvelope = {
        agent_id: passport.agent_id,
        passport_id: passport.passport_id,
        user_request: request,
        active_system_prompt_hash: passport.active_system_prompt_hash,
        authority_scope: passport.authority_scope,
        requested_tools: requestedToolsFromBody(body.requested_tools),
        memory_refs: priorSummary ? [`summary:${priorSummary.length}`] : [],
        risk_context: passport.risk_context ?? "public_chat",
      };
      const receipts: Receipt[] = [];
      const promptVerdict = kernel.evaluatePrompt(envelope);
      receipts.push(receiptFor(envelope, promptVerdict, "pre_llm"));
      if (isBlockingIdentityVerdict(promptVerdict)) {
        return c.json({ ok: false, error: "identity kernel refused prompt", reason: promptVerdict.reason, safe_instruction: promptVerdict.safe_instruction, receipts }, 403);
      }

      if (priorSummary) {
        const contextVerdict = kernel.evaluateContext(envelope, { kind: "memory", text: priorSummary });
        receipts.push(receiptFor(envelope, contextVerdict, "context"));
        if (isBlockingIdentityVerdict(contextVerdict)) {
          return c.json({ ok: false, error: "identity kernel refused context", reason: contextVerdict.reason, safe_instruction: contextVerdict.safe_instruction, receipts }, 403);
        }
        if (contextVerdict.verdict === "transform") priorSummary = undefined;
      }

      chatIdentity = { envelope, kernel, receipts };
    }

    // hermes brain = the REAL read-only Leonardo agent over ACP (its own tool loop,
    // memory, and compaction); it bypasses runChatTurn. Other brains use runChatTurn.
    const useHermes = brainKind === "hermes";

    // The codex/openai/anthropic brain is only needed for the runChatTurn path.
    let client: AnthropicLike | null = null;
    if (!useHermes) {
      try {
        client = await getBrain();
      } catch {
        return c.json({ ok: false, error: "chat is not configured" }, 503);
      }
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        // Every 5s — must stay well under Bun's idleTimeout so a quiet turn (agent
        // thinking, or waiting for the single-bridge lock) doesn't get its
        // connection closed mid-stream.
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(enc.encode(HEARTBEAT));
          } catch {
            clearInterval(heartbeat);
          }
        }, 5_000);
        // Feed the per-wallet activity history from the live frames.
        const histWallet = sessionWallet ?? paidBy;
        let assistantText = "";
        let pendingTool: { name: string; args: unknown } | null = null;
        const bufferedFrames: ChatFrame[] = [];
        const enqueueAnyFrame = (frame: ChatFrame | IdentityKernelFrame) => controller.enqueue(enc.encode(encodeFrame(frame as ChatFrame)));
        const sendOrBuffer = (frame: ChatFrame) => {
          if (chatIdentity) bufferedFrames.push(frame);
          else enqueueAnyFrame(frame);
        };
        const flushBuffered = () => {
          for (const buffered of bufferedFrames) enqueueAnyFrame(buffered);
          bufferedFrames.length = 0;
        };
        try {
          if (freebie) {
            const remaining = consumeFree(freebie);
            enqueueAnyFrame({ type: "free", remaining });
            logUsage({ wallet: freebie, kind: "chat_free", units: 1 });
          }
          if (chatIdentity && chatIdentity.receipts.length > 0) {
            enqueueAnyFrame(identityKernelFrame(chatIdentity, chatIdentity.receipts));
          }
          // Pick the frame source: the real Hermes agent (ACP) or runChatTurn.
          const conversationId =
            (typeof body.conversationId === "string" && body.conversationId) || histWallet || "anon";
          // Wallet-scoped identity: if we know the member, hand Leonardo a
          // read-only member-context preamble (recognized member + recall of their
          // OWN past conversations). Anonymous callers get no preamble.
          const preamble = useHermes && histWallet ? buildPreamble(loadIdentity(histWallet), conversationId) : undefined;
          const frames = useHermes
            ? runHermesTurn({ conversationId, text: typeof lastUser?.content === "string" ? lastUser.content : "", preamble })
            : runChatTurn({ client: client!, model: chatModel, messages: body.messages, deps: { graphSearch, searchCouncil: searchCouncilMemory }, priorSummary });
          for await (const frame of frames) {
            if (chatIdentity && frame.type === "tool_start") {
              const toolVerdict = chatIdentity.kernel.evaluateToolCall(chatIdentity.envelope, { name: frame.name, args: frame.args });
              const toolReceipt = receiptFor(chatIdentity.envelope, toolVerdict, "tool");
              enqueueAnyFrame(identityKernelFrame(chatIdentity, [toolReceipt]));
              if (isBlockingIdentityVerdict(toolVerdict)) {
                enqueueAnyFrame({ type: "error", message: explainRefusal(toolVerdict) });
                enqueueAnyFrame({ type: "done" });
                return;
              }
            } else if (chatIdentity && frame.type === "confirm_required") {
              const toolVerdict = chatIdentity.kernel.evaluateToolCall(chatIdentity.envelope, { name: frame.action, args: frame.args });
              const toolReceipt = receiptFor(chatIdentity.envelope, toolVerdict, "tool");
              enqueueAnyFrame(identityKernelFrame(chatIdentity, [toolReceipt]));
              if (isBlockingIdentityVerdict(toolVerdict)) {
                enqueueAnyFrame({ type: "error", message: explainRefusal(toolVerdict) });
                enqueueAnyFrame({ type: "done" });
                return;
              }
            }

            if (frame.type === "usage") {
              logUsage({ wallet: payer, kind: "chat", units: frame.in + frame.out });
            } else if (frame.type === "text") {
              assistantText += frame.delta;
            } else if (frame.type === "tool_start") {
              pendingTool = { name: frame.name, args: frame.args };
            } else if (frame.type === "tool_result" && histWallet && pendingTool) {
              try {
                const args = (pendingTool.args ?? {}) as Record<string, unknown>;
                if (frame.name === "search_graph") {
                  const hits = ((frame.payload as { hits?: { name: string }[] })?.hits ?? []).map((h) => h.name);
                  appendHistory(histWallet, { kind: "graph", q: String(args.query ?? ""), a: hits.slice(0, 6).join(" · ") || "no hits" });
                } else if (frame.name === "workshop_research") {
                  const p = frame.payload as { what_it_is?: string; note?: string; message?: string };
                  appendHistory(histWallet, { kind: "workshop", q: String(args.topic ?? ""), a: p.what_it_is ?? p.note ?? p.message ?? "" });
                }
              } catch {
                // history is best-effort
              }
              pendingTool = null;
            }

            if (chatIdentity && frame.type === "done" && !frame.pending) {
              const outputVerdict = chatIdentity.kernel.evaluateOutput(chatIdentity.envelope, { draft_output: assistantText });
              const outputReceipt = receiptFor(chatIdentity.envelope, outputVerdict, "output");
              enqueueAnyFrame(identityKernelFrame(chatIdentity, [outputReceipt]));
              if (isBlockingIdentityVerdict(outputVerdict)) {
                enqueueAnyFrame({ type: "error", message: explainRefusal(outputVerdict) });
                enqueueAnyFrame({ type: "done" });
                return;
              }
              if (outputVerdict.verdict === "transform") {
                for (const buffered of bufferedFrames) {
                  if (buffered.type !== "text" && buffered.type !== "assistant_message") enqueueAnyFrame(buffered);
                }
                bufferedFrames.length = 0;
                enqueueAnyFrame({ type: "text", delta: outputVerdict.safe_instruction });
                enqueueAnyFrame(frame);
              } else {
                flushBuffered();
                enqueueAnyFrame(frame);
              }
              continue;
            }

            sendOrBuffer(frame);
          }
          if (histWallet && lastUser && assistantText.trim()) {
            try {
              appendHistory(histWallet, { kind: "chat", q: String(lastUser.content), a: assistantText });
            } catch {
              // best-effort
            }
          }
          // Update wallet-scoped identity: bump last-seen / visit count and stash a
          // summary so future visits recall the gist. Prefer the client's richer
          // compaction summary; otherwise synthesize a one-liner from this exchange
          // (so even short, never-compacted chats leave something recallable).
          if (useHermes && histWallet) {
            try {
              const firstUser = msgs.find((m) => m.role === "user" && typeof m.content === "string");
              const recallSummary =
                priorSummary && priorSummary.trim()
                  ? priorSummary
                  : oneLineSummary(String(firstUser?.content ?? lastUser?.content ?? ""), assistantText);
              recordTurn(histWallet, conversationId, recallSummary);
            } catch {
              // identity is best-effort
            }
          }
        } catch {
          controller.enqueue(enc.encode(encodeFrame({ type: "error", message: "stream failed" })));
        } finally {
          clearInterval(heartbeat);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      },
    });
  });

  return app;
}
