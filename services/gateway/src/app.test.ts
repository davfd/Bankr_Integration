import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { createGatewayApp } from "./app";
import type { CouncilReviewer } from "./council";

const TEST_SESSION_SECRET = "gateway-app-test-secret";
const TEST_INTAKE_RECEIPT_SECRET = "gateway-app-intake-receipt-secret";
const TEST_WALLET = "0xabc0000000000000000000000000000000000001";
let testIntakeRoot = "";

function mintSessionToken(wallet = TEST_WALLET, expMs = Date.now() + 60_000): string {
  const normalized = wallet.toLowerCase();
  const payload = `leo2.${normalized}.${expMs}.holder`;
  const sig = createHmac("sha256", TEST_SESSION_SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

// Injected mock — keeps the suite deterministic and offline (no model calls).
const mockReviewer: CouncilReviewer = async ({ idea, seat }) => ({
  seat: seat ?? "archimedes",
  verdict: `MOCK VERDICT for: ${idea.slice(0, 24)}`,
  ms: 1,
});

beforeEach(() => {
  delete process.env.GATEWAY_TOKEN;
  delete process.env.GATEWAY_PAYER_ALLOWLIST;
  delete process.env.WORKSHOP_SIDECAR_URL;
  delete process.env.CHAT_BRAIN;
  delete process.env.CHAT_MODEL;
  testIntakeRoot = mkdtempSync(join(tmpdir(), "leo-intake-test-"));
  process.env.INTAKE_ROOT = testIntakeRoot;
  process.env.INTAKE_RECEIPT_SECRET = TEST_INTAKE_RECEIPT_SECRET;
});

afterEach(() => {
  if (testIntakeRoot) rmSync(testIntakeRoot, { recursive: true, force: true });
  testIntakeRoot = "";
  delete process.env.INTAKE_ROOT;
  delete process.env.INTAKE_RECEIPT_SECRET;
  delete process.env.SESSION_SECRET;
});

describe("gateway · functions behind the tiles", () => {
  it("health is free and ok", async () => {
    const app = createGatewayApp({ meter: false, councilReview: mockReviewer });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("exposes safe Bankr readiness for the product status surface", async () => {
    const app = createGatewayApp({
      meter: false,
      councilReview: mockReviewer,
      bankrReadiness: {
        configured: true,
        mode: "read_only",
        api_base_url: "https://api.bankr.bot",
        governed_writes: { requested: false, ready: false, reason: "BANKR_GOVERNED_WRITES_ENABLED is not true" },
        receipt_publish: { configured: true, ready: true, reason: "BANKR_RECEIPT_PUBLISH_PATH configured", endpoint_path: "/receipts" },
        x402_payment: { requested: true, configured: true, ready: true, reason: "BANKR_X402 payment path configured", endpoint_path: "/x402/pay" },
      },
    });

    const res = await app.request("/api/bankr/readiness");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; bankr: Record<string, unknown> };
    expect(body).toMatchObject({
      ok: true,
      bankr: {
        configured: true,
        mode: "read_only",
        receipt_publish: { configured: true, ready: true, endpoint_path: "/receipts" },
        x402_payment: { requested: true, configured: true, ready: true, endpoint_path: "/x402/pay" },
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/bk_|Bearer|x-api-key|secret/i);
  });

  it("runs a sanitized operator-triggered Bankr read-only live-smoke receipt", async () => {
    const app = createGatewayApp({
      meter: false,
      councilReview: mockReviewer,
      bankrLiveSmokeRunner: async () => ({
        ready: true,
        status: "pass",
        readiness_mode: "read_only",
        governed_writes: { requested: false, ready: false, reason: "BANKR_GOVERNED_WRITES_ENABLED is not true" },
        receipt_publish: { configured: true, ready: true, reason: "BANKR_RECEIPT_PUBLISH_PATH configured", endpoint_path: "/receipts" },
        x402_payment: { requested: false, configured: false, ready: false, reason: "BANKR_X402_PAYMENTS_ENABLED is not true" },
        active_mcp_token_count: 0,
        acknowledged_existing_mcp_token_revocation: true,
        server: "leonardo-base-identity-kernel",
        has_expected_wrappers: true,
        has_raw_write_tool: false,
        read_payload_ok: true,
        read_decision: "allow",
        read_tool: "read_wallet_state",
        result_provider: "bankr",
        result_mode: "read_only",
        revoked_token: true,
        blocked_reason: "sanitized pass receipt",
      }),
    });

    const res = await app.request("/api/bankr/live-smoke", { method: "POST" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; bankr_live_smoke: Record<string, unknown> };
    expect(body).toMatchObject({
      ok: true,
      bankr_live_smoke: {
        ready: true,
        status: "pass",
        readiness_mode: "read_only",
        active_mcp_token_count: 0,
        has_raw_write_tool: false,
        read_tool: "read_wallet_state",
        result_provider: "bankr",
        result_mode: "read_only",
        revoked_token: true,
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/bk_|Bearer|x-api-key|secret/i);
  });

  it("refuses to pass a Bankr live-smoke receipt that omits active_mcp_token_count", async () => {
    const app = createGatewayApp({
      meter: false,
      councilReview: mockReviewer,
      bankrLiveSmokeRunner: async () => ({
        ready: true,
        status: "pass",
        readiness_mode: "read_only",
        acknowledged_existing_mcp_token_revocation: true,
        server: "leonardo-base-identity-kernel",
        has_expected_wrappers: true,
        has_raw_write_tool: false,
        read_payload_ok: true,
        read_decision: "allow",
        read_tool: "read_wallet_state",
        result_provider: "bankr",
        result_mode: "read_only",
        revoked_token: true,
      }),
    });

    const res = await app.request("/api/bankr/live-smoke", { method: "POST" });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; bankr_live_smoke: Record<string, unknown> };
    expect(body.ok).toBe(false);
    expect(body.bankr_live_smoke.ready).toBe(false);
    expect(body.bankr_live_smoke.status).toBe("fail");
    expect(body.bankr_live_smoke.blocked_reason).toContain("active_mcp_token_count");
    expect(JSON.stringify(body)).not.toMatch(/bk_|Bearer|x-api-key|secret/i);
  });

  it("keeps the Bankr live-smoke route disabled unless the operator explicitly enables it", async () => {
    const app = createGatewayApp({ meter: false, councilReview: mockReviewer });

    const res = await app.request("/api/bankr/live-smoke", { method: "POST" });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error: string; bankr_live_smoke: Record<string, unknown> };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("bankr live smoke route disabled");
    expect(body.bankr_live_smoke.status).toMatch(/^blocked_/);
    expect(JSON.stringify(body)).not.toMatch(/bk_|Bearer|x-api-key|secret/i);
  });

  it("council review runs the reviewer and returns a verdict", async () => {
    const app = createGatewayApp({ meter: false, councilReview: mockReviewer });
    const res = await app.request("/api/council/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "true-name custody binding" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; seat: string; verdict: string };
    expect(body.ok).toBe(true);
    expect(body.seat).toBe("archimedes");
    expect(body.verdict).toContain("MOCK VERDICT");
  });

  it("council review rejects an empty idea with 400", async () => {
    const app = createGatewayApp({ meter: false, councilReview: mockReviewer });
    const res = await app.request("/api/council/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });

  it("graph search returns hits from the (injected) searcher", async () => {
    const app = createGatewayApp({
      meter: false,
      councilReview: mockReviewer,
      graphSearch: async (q) => [{ id: "c1", name: `match:${q}`, mentions: 42, domain: "myth", sourceKind: "fiction" }],
    });
    const res = await app.request("/api/graph/search?q=memory");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; hits: { name: string }[] };
    expect(body.ok).toBe(true);
    expect(body.hits[0]?.name).toBe("match:memory");
  });

  it("graph search short-circuits queries under 2 chars", async () => {
    const app = createGatewayApp({ meter: false, councilReview: mockReviewer });
    const res = await app.request("/api/graph/search?q=a");
    expect(res.status).toBe(200);
    expect((await res.json()).hits).toEqual([]);
  });

  it("council panel returns every seat verdict + a synthesis", async () => {
    const mockPanel = async ({ idea }: { idea: string }) => ({
      verdicts: ["kallimachos", "sextus", "archimedes", "philo", "humboldt"].map((s) => ({
        seat: s,
        verdict: `MOCK ${s}: ${idea.slice(0, 12)}`,
        ms: 1,
      })),
      synthesis: "MOCK SYNTHESIS · REVISE",
      ms: 5,
    });
    const app = createGatewayApp({ meter: false, councilReview: mockReviewer, councilPanel: mockPanel });
    const res = await app.request("/api/council/panel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "true-name custody binding" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; verdicts: { seat: string }[]; synthesis: string };
    expect(body.ok).toBe(true);
    expect(body.verdicts).toHaveLength(5);
    expect(body.synthesis).toContain("SYNTHESIS");
  });

  it("council panel is metered ($0.25) — 402 without payment (paying buys access, not the verdict)", async () => {
    const app = createGatewayApp({ meter: true });
    const res = await app.request("/api/council/panel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "x" }),
    });
    expect(res.status).toBe(402);
  });

  it("payer allowlist rejects a disallowed x402 payer (403) and admits the listed one", async () => {
    process.env.GATEWAY_PAYER_ALLOWLIST = "0xaaaa000000000000000000000000000000000001";
    const app = createGatewayApp({ meter: false, councilReview: mockReviewer });
    const xpay = (from: string) =>
      Buffer.from(JSON.stringify({ payload: { authorization: { from } } })).toString("base64");
    const denied = await app.request("/api/council/review", {
      method: "POST",
      headers: { "content-type": "application/json", "x-payment": xpay("0xbbbb000000000000000000000000000000000002") },
      body: JSON.stringify({ idea: "test" }),
    });
    expect(denied.status).toBe(403);
    const ok = await app.request("/api/council/review", {
      method: "POST",
      headers: { "content-type": "application/json", "x-payment": xpay("0xAAAA000000000000000000000000000000000001") },
      body: JSON.stringify({ idea: "test idea" }),
    });
    expect(ok.status).toBe(200); // case-insensitive match, payment settlement skipped (meter off)
    delete process.env.GATEWAY_PAYER_ALLOWLIST;
  });

  it("access token gates every route (except /health) when GATEWAY_TOKEN is set", async () => {
    process.env.GATEWAY_TOKEN = "s3cret";
    const app = createGatewayApp({ meter: false, councilReview: mockReviewer, graphSearch: async () => [] });
    expect((await app.request("/api/graph/search?q=memory")).status).toBe(401);
    expect((await app.request("/api/graph/search?q=memory", { headers: { authorization: "Bearer s3cret" } })).status).toBe(200);
    expect((await app.request("/health")).status).toBe(200); // exempt
    delete process.env.GATEWAY_TOKEN;
  });

  it("metering gates the council route with HTTP 402 when enabled", async () => {
    const app = createGatewayApp({ meter: true, councilReview: mockReviewer });
    const res = await app.request("/api/council/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "x" }),
    });
    expect(res.status).toBe(402);
  });

  it("queues Council planning intake with a receipt, without selling a verdict", async () => {
    process.env.SESSION_SECRET = TEST_SESSION_SECRET;
    const logged: Array<{ wallet: string; kind: string; units: number }> = [];
    const app = createGatewayApp({ meter: false, councilReview: mockReviewer, logUsage: (e) => logged.push(e) });
    const res = await app.request("/api/council/plan", {
      method: "POST",
      headers: { "content-type": "application/json", "x-leo-session": mintSessionToken() },
      body: JSON.stringify({ title: "Agent Passport launch plan", brief: "Plan a holder-gated Agent Passport beta with receipts." }),
    });
    delete process.env.SESSION_SECRET;

    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      ok: boolean;
      request: { kind: string; status: string; wallet: string; receipt_sha256: string; receipt: { boundary: string; purchased: string } };
    };
    expect(body.ok).toBe(true);
    expect(body.request.kind).toBe("council_plan");
    expect(body.request.status).toBe("queued");
    expect(body.request.wallet).toBe(TEST_WALLET);
    expect(body.request.receipt_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(body.request.receipt.boundary).toMatch(/does not buy verdict/i);
    expect(body.request.receipt.boundary).toMatch(/truth/i);
    expect(body.request.receipt.boundary).toMatch(/Scripture interpretation/i);
    expect(body.request.receipt.purchased).toBe("intake_queue_slot");
    expect(JSON.stringify(body)).not.toMatch(/VERIFIED|CONTESTED|PASS|FAIL/);
    expect(logged).toEqual([{ wallet: TEST_WALLET, kind: "council_plan_intake", units: 1 }]);
  });

  it("queues Council audit intake with receipt language that buys review access only", async () => {
    process.env.SESSION_SECRET = TEST_SESSION_SECRET;
    const app = createGatewayApp({ meter: false, councilReview: mockReviewer });
    const res = await app.request("/api/council/audit", {
      method: "POST",
      headers: { "content-type": "application/json", "x-leo-session": mintSessionToken() },
      body: JSON.stringify({ title: "Quest payout audit", artifact_url: "https://example.com/quest.md", brief: "Audit this quest for wash-farming risk." }),
    });
    delete process.env.SESSION_SECRET;

    expect(res.status).toBe(202);
    const body = (await res.json()) as { request: { kind: string; receipt: { boundary: string; target?: string } } };
    expect(body.request.kind).toBe("council_audit");
    expect(body.request.receipt.target).toBe("https://example.com/quest.md");
    expect(body.request.receipt.boundary).toMatch(/not.*pass/i);
  });

  it("queues Workshop intake for brief/reproduction/build with receipts, not promised outcomes", async () => {
    process.env.SESSION_SECRET = TEST_SESSION_SECRET;
    const app = createGatewayApp({ meter: false, councilReview: mockReviewer });
    const res = await app.request("/api/workshop/intake", {
      method: "POST",
      headers: { "content-type": "application/json", "x-leo-session": mintSessionToken() },
      body: JSON.stringify({ kind: "reproduction", title: "Reproduce MCP Council Memory smoke", brief: "Run the smoke and return hashes." }),
    });
    delete process.env.SESSION_SECRET;

    expect(res.status).toBe(202);
    const body = (await res.json()) as { request: { kind: string; status: string; receipt_sha256: string; receipt: { purchased: string; boundary: string } } };
    expect(body.request.kind).toBe("workshop_reproduction");
    expect(body.request.status).toBe("queued");
    expect(body.request.receipt_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(body.request.receipt.purchased).toBe("workshop_intake_slot");
    expect(body.request.receipt.boundary).toMatch(/does not buy result/i);
  });

  it("paid intake routes require wallet sign-in before any x402 payment challenge", async () => {
    const app = createGatewayApp({ meter: true, councilReview: mockReviewer });
    for (const path of ["/api/council/plan", "/api/council/audit", "/api/workshop/intake"]) {
      const res = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "metered", brief: "metered request" }),
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ ok: false, error: "sign in first" });
    }
  });

  it("paid intake routes are x402-metered after wallet sign-in when metering is enabled", async () => {
    process.env.SESSION_SECRET = TEST_SESSION_SECRET;
    const app = createGatewayApp({ meter: true, councilReview: mockReviewer });
    for (const path of ["/api/council/plan", "/api/council/audit", "/api/workshop/intake"]) {
      const res = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-leo-session": mintSessionToken() },
        body: JSON.stringify({ title: "metered", brief: "metered request" }),
      });
      expect(res.status).toBe(402);
    }
  });

  it("paid intake routes fail closed on missing receipt configuration before x402 challenge", async () => {
    process.env.SESSION_SECRET = TEST_SESSION_SECRET;
    delete process.env.INTAKE_RECEIPT_SECRET;
    const app = createGatewayApp({ meter: true, councilReview: mockReviewer });

    const res = await app.request("/api/council/plan", {
      method: "POST",
      headers: { "content-type": "application/json", "x-leo-session": mintSessionToken() },
      body: JSON.stringify({ title: "metered", brief: "metered request" }),
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "intake unavailable" });
  });

  it("paid intake routes fail closed on unavailable wallet ledger storage before x402 challenge", async () => {
    process.env.SESSION_SECRET = TEST_SESSION_SECRET;
    mkdirSync(join(testIntakeRoot, `${TEST_WALLET}.json`));
    const app = createGatewayApp({ meter: true, councilReview: mockReviewer });

    const res = await app.request("/api/council/plan", {
      method: "POST",
      headers: { "content-type": "application/json", "x-leo-session": mintSessionToken() },
      body: JSON.stringify({ title: "metered", brief: "metered request" }),
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "intake unavailable" });
  });

  it("exposes a wallet-scoped intake receipt ledger without raw briefs", async () => {
    process.env.SESSION_SECRET = TEST_SESSION_SECRET;
    const app = createGatewayApp({ meter: false, councilReview: mockReviewer });
    const queued = await app.request("/api/council/plan", {
      method: "POST",
      headers: { "content-type": "application/json", "x-leo-session": mintSessionToken() },
      body: JSON.stringify({ title: "Full-system plan", brief: "private planning brief that must not leak raw" }),
    });
    expect(queued.status).toBe(202);
    const queuedBody = (await queued.json()) as { request: { id: string; receipt_sha256: string } };

    const listed = await app.request("/api/intake/requests", { headers: { "x-leo-session": mintSessionToken() } });
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as { ok: boolean; requests: Array<{ id: string; receipt_sha256: string; receipt: { boundary: string; brief_commitment_sha256: string; brief_commitment_scheme: string; brief_sha256?: string } }> };
    expect(listBody.ok).toBe(true);
    expect(listBody.requests.map((r) => r.id)).toContain(queuedBody.request.id);
    expect(listBody.requests[0]!.receipt_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(listBody.requests[0]!.receipt.brief_commitment_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(listBody.requests[0]!.receipt.brief_commitment_scheme).toBe("hmac-sha256:leo-intake-brief-v1");
    expect(listBody.requests[0]!.receipt.brief_sha256).toBeUndefined();
    expect(listBody.requests[0]!.receipt.boundary).toMatch(/does not buy verdict/i);
    expect(listBody.requests[0]!.receipt.boundary).toMatch(/server-keyed commitment/i);
    expect(JSON.stringify(listBody)).not.toContain("private planning brief");

    const receipt = await app.request(`/api/intake/requests/${encodeURIComponent(queuedBody.request.id)}/receipt`, {
      headers: { "x-leo-session": mintSessionToken() },
    });
    expect(receipt.status).toBe(200);
    const receiptBody = (await receipt.json()) as { ok: boolean; receipt: { version: string; request_id: string; brief_sha256?: string } };
    expect(receiptBody).toMatchObject({ ok: true, receipt: { version: "leo-intake-v1", request_id: queuedBody.request.id } });
    expect(receiptBody.receipt.brief_sha256).toBeUndefined();
  });

  it("keeps intake receipt ledgers isolated by wallet", async () => {
    process.env.SESSION_SECRET = TEST_SESSION_SECRET;
    const otherWallet = "0xdef0000000000000000000000000000000000002";
    const app = createGatewayApp({ meter: false, councilReview: mockReviewer });
    const queued = await app.request("/api/workshop/intake", {
      method: "POST",
      headers: { "content-type": "application/json", "x-leo-session": mintSessionToken() },
      body: JSON.stringify({ kind: "build", title: "Build receipt harness", brief: "Private workshop build brief" }),
    });
    expect(queued.status).toBe(202);
    const queuedBody = (await queued.json()) as { request: { id: string } };

    const otherList = await app.request("/api/intake/requests", { headers: { "x-leo-session": mintSessionToken(otherWallet) } });
    expect(otherList.status).toBe(200);
    expect(await otherList.json()).toMatchObject({ ok: true, requests: [] });

    const otherReceipt = await app.request(`/api/intake/requests/${encodeURIComponent(queuedBody.request.id)}/receipt`, {
      headers: { "x-leo-session": mintSessionToken(otherWallet) },
    });
    expect(otherReceipt.status).toBe(404);
  });
});

describe("gateway · chat route", () => {
  const scriptedAnthropic = {
    messages: {
      stream() {
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: "content_block_delta", delta: { type: "text_delta", text: "ciao" } };
          },
          async finalMessage() {
            return {
              content: [{ type: "text", text: "ciao" }],
              stop_reason: "end_turn",
              usage: { input_tokens: 50, output_tokens: 7 },
            };
          },
        };
      },
    },
  };

  it("streams SSE frames and logs usage keyed by the x402 payer", async () => {
    const logged: Array<{ wallet: string; kind: string; units: number }> = [];
    const app = createGatewayApp({
      meter: false,
      councilReview: mockReviewer,
      anthropic: scriptedAnthropic,
      logUsage: (e) => logged.push(e),
    });
    const xpay = Buffer.from(JSON.stringify({ payload: { authorization: { from: "0xAbCd000000000000000000000000000000000001" } } })).toString("base64");
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-payment": xpay },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain('"type":"text"');
    expect(text).toContain('"delta":"ciao"');
    expect(text).toContain('"type":"done"');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toEqual({ wallet: "0xabcd000000000000000000000000000000000001", kind: "chat", units: 57 });
  });

  it("is metered — 402 without payment", async () => {
    const app = createGatewayApp({ meter: true, anthropic: scriptedAnthropic });
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(402);
  });

  it("is token-gated like every route", async () => {
    process.env.GATEWAY_TOKEN = "s3cret";
    const app = createGatewayApp({ meter: false, anthropic: scriptedAnthropic });
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(401);
    delete process.env.GATEWAY_TOKEN;
  });

  it("rejects oversized bodies with 413 and bad json with 400", async () => {
    const app = createGatewayApp({ meter: false, anthropic: scriptedAnthropic });
    const big = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "z".repeat(70_000) }] }),
    });
    expect(big.status).toBe(413);
    const bad = await app.request("/api/chat", { method: "POST", body: "{nope" });
    expect(bad.status).toBe(400);
  });

  it("returns 503 when the anthropic brain is selected without a key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CHAT_BRAIN = "anthropic";
    const app = createGatewayApp({ meter: false });
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(503);
    delete process.env.CHAT_BRAIN;
  });
});

describe("gateway · security hardening", () => {
  const app = () =>
    createGatewayApp({ meter: false, councilReview: mockReviewer, graphSearch: async () => [] });

  it("sets hardening headers on responses", async () => {
    const res = await app().request("/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("CORS allows localhost + *.vercel.app and denies unknown origins", async () => {
    const vercel = await app().request("/health", { headers: { origin: "https://web-abc123.vercel.app" } });
    expect(vercel.headers.get("access-control-allow-origin")).toBe("https://web-abc123.vercel.app");
    const local = await app().request("/health", { headers: { origin: "http://localhost:3000" } });
    expect(local.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const evil = await app().request("/health", { headers: { origin: "https://evil.example.com" } });
    expect(evil.headers.get("access-control-allow-origin")).not.toBe("https://evil.example.com");
  });

  it("rejects an oversized idea with 413", async () => {
    const res = await app().request("/api/council/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "x".repeat(5000) }),
    });
    expect(res.status).toBe(413);
  });

  it("ignores a malformed seat (no prototype pollution) but accepts a valid one", async () => {
    const bad = await app().request("/api/council/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "test", seat: "__proto__" }),
    });
    expect(((await bad.json()) as { seat: string }).seat).toBe("archimedes"); // fell back to default
    const good = await app().request("/api/council/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "test", seat: "kallimachos" }),
    });
    expect(((await good.json()) as { seat: string }).seat).toBe("kallimachos");
  });

  it("rate-limits a flood from one client with 429", async () => {
    process.env.GATEWAY_RATE_LIMIT = "3";
    const a = createGatewayApp({ meter: false, councilReview: mockReviewer, graphSearch: async () => [] });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await a.request("/health")).status);
    delete process.env.GATEWAY_RATE_LIMIT;
    expect(codes[0]).toBe(200);
    expect(codes.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it("rejects wrong / wrong-length tokens, accepts the exact token", async () => {
    process.env.GATEWAY_TOKEN = "the-real-token";
    const a = createGatewayApp({ meter: false, councilReview: mockReviewer, graphSearch: async () => [] });
    expect((await a.request("/api/graph/search?q=memory", { headers: { authorization: "Bearer short" } })).status).toBe(401);
    expect((await a.request("/api/graph/search?q=memory", { headers: { authorization: "Bearer the-real-token" } })).status).toBe(200);
    delete process.env.GATEWAY_TOKEN;
  });
});
