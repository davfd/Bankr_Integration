import { afterEach, describe, expect, it, vi } from "vitest";
import { verifySessionToken } from "./chat/freebies";
import {
  BANKR_LIVE_SMOKE_EXPECTED_TOOLS,
  bankrLiveSmokePasses,
  blockedBankrLiveSmokeReceiptFromEnv,
  buildBankrLiveSmokeReceipt,
  buildSessionToken,
  gatewayApiBase,
  requestGatewayBaseMcpToken,
  runBankrLiveSmoke,
  safeBankrLiveSmokeJson,
  shouldRequireGatewayBearer,
} from "./bankr-live-smoke";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SESSION_SECRET;
});

const OK_INPUT = {
  readiness: { configured: true, mode: "read_only" as const },
  tokenCreateStatus: 200,
  initStatus: 200,
  server: "leonardo-base-identity-kernel",
  toolsStatus: 200,
  toolNames: [...BANKR_LIVE_SMOKE_EXPECTED_TOOLS],
  readCallStatus: 200,
  readPayload: {
    ok: true,
    decision: "allow",
    tool: "read_wallet_state",
    result: {
      provider: "bankr",
      mode: "read_only",
      bankr_wallet: { address: "0xrawshouldnotprint" },
      portfolio: { balances: [{ symbol: "RAW", amount: "999" }] },
    },
  },
  revokedToken: true,
};

describe("Bankr Base MCP live-smoke receipt", () => {
  it("passes only for governed wrapper tools and summarized read-only Bankr result", () => {
    const receipt = buildBankrLiveSmokeReceipt(OK_INPUT);

    expect(receipt).toMatchObject({
      ready: true,
      status: "pass",
      server: "leonardo-base-identity-kernel",
      has_expected_wrappers: true,
      has_raw_write_tool: false,
      read_decision: "allow",
      read_tool: "read_wallet_state",
      result_provider: "bankr",
      result_mode: "read_only",
      revoked_token: true,
    });
    expect(bankrLiveSmokePasses(receipt)).toBe(true);
    const json = safeBankrLiveSmokeJson(receipt);
    expect(json).not.toContain("0xrawshouldnotprint");
    expect(json).not.toContain("999");
  });

  it("fails if raw Bankr/write-like tools appear in tools/list", () => {
    const receipt = buildBankrLiveSmokeReceipt({ ...OK_INPUT, toolNames: [...OK_INPUT.toolNames, "wallet_sign", "transfer"] });

    expect(receipt.has_raw_write_tool).toBe(true);
    expect(receipt.status).toBe("fail");
    expect(bankrLiveSmokePasses(receipt)).toBe(false);
  });

  it("redacts MCP tokens, session tokens, Bankr keys, auth headers, API-key headers, and raw result bodies", () => {
    const json = safeBankrLiveSmokeJson({
      token: "leo_mcp_super_secret",
      session: "x-leo-session: abc.def.ghi",
      key: "bk_live_secret",
      Authorization: "Bearer gateway_secret",
      "X-API-Key": "bk_header_secret",
      raw_result_body: { bankr_wallet: { address: "0xraw" }, portfolio: { balances: ["rawbalance"] } },
    });

    expect(json).not.toContain("leo_mcp_super_secret");
    expect(json).not.toContain("abc.def.ghi");
    expect(json).not.toContain("bk_live_secret");
    expect(json).not.toContain("gateway_secret");
    expect(json).not.toContain("0xraw");
    expect(json).not.toContain("rawbalance");
    expect(json).toContain("[REDACTED]");
  });

  it("keeps token-lifecycle receipt fields visible while redacting secret token values", () => {
    const json = safeBankrLiveSmokeJson({
      active_mcp_token_count: 2,
      acknowledged_existing_mcp_token_revocation: true,
      revoked_token: true,
      token: "leo_mcp_super_secret",
    });

    expect(json).toContain('"active_mcp_token_count": 2');
    expect(json).toContain('"acknowledged_existing_mcp_token_revocation": true');
    expect(json).toContain('"revoked_token": true');
    expect(json).not.toContain("leo_mcp_super_secret");
  });

  it("blocks before live calls when required config is missing", () => {
    expect(blockedBankrLiveSmokeReceiptFromEnv({}).status).toBe("blocked_missing_key");
    expect(blockedBankrLiveSmokeReceiptFromEnv({ BANKR_API_KEY: "bk_live_secret" }).status).toBe("blocked_missing_config");
  });

  it("exposes redacted Approval Authority readiness in preflight receipts without live smoke config", () => {
    const receipt = blockedBankrLiveSmokeReceiptFromEnv({
      BANKR_API_KEY: "bk_live_secret",
      BANKR_API_BASE_URL: "https://api.bankr.bot",
      BANKR_GOVERNED_WRITES_ENABLED: "true",
      BANKR_APPROVAL_STORE_PATH: "/tmp/nonprod-bankr/approvals/approvals.json",
      BANKR_APPROVAL_USAGE_STORE_PATH: "/tmp/nonprod-bankr/usage",
      BANKR_APPROVAL_AUDIT_LOG_PATH: "/tmp/nonprod-bankr/audit/audit.jsonl",
      BANKR_APPROVAL_SIGNING_SECRET: "0123456789abcdef0123456789abcdef",
    });

    expect(receipt.status).toBe("blocked_missing_config");
    expect(receipt.governed_writes).toEqual({
      requested: true,
      ready: true,
      reason: "Approval Authority env complete",
    });
    const json = safeBankrLiveSmokeJson(receipt);
    expect(json).not.toContain("0123456789abcdef0123456789abcdef");
    expect(json).not.toContain("/tmp/nonprod-bankr");
    expect(json).not.toContain("bk_live_secret");
  });

  it("blocks before token issuance when a locked gateway needs a frontend bearer", () => {
    const receipt = blockedBankrLiveSmokeReceiptFromEnv({
      BANKR_API_KEY: "bk_live_secret",
      BANKR_LIVE_SMOKE_REQUIRE_GATEWAY_TOKEN: "true",
      BANKR_LIVE_SMOKE_ENDPOINT: "https://example.test/mcp/base",
      BANKR_LIVE_SMOKE_WALLET: "0xaaaa000000000000000000000000000000000001",
      BANKR_LIVE_SMOKE_PASSPORT_ID: "6960",
      SESSION_SECRET: "session-secret",
    });

    expect(receipt.status).toBe("blocked_missing_frontend_bearer");
  });

  it("blocks before token creation when the smoke wallet already has an active MCP token and no acknowledgement", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const method = String(init?.method ?? "GET");
      calls.push({ url: String(input), method });
      if (String(input).endsWith("/api/mcp/tokens") && method === "GET") {
        return new Response(JSON.stringify({ ok: true, tokens: [{ id: "existing", revokedAt: null, scopes: ["graph:read"] }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${method} ${String(input)}`);
    });

    const receipt = await runBankrLiveSmoke({
      BANKR_API_KEY: "bk_live_secret",
      BANKR_LIVE_SMOKE_ENDPOINT: "https://gateway.example/mcp/base",
      BANKR_LIVE_SMOKE_WALLET: "0xaaaa000000000000000000000000000000000001",
      BANKR_LIVE_SMOKE_PASSPORT_ID: "6960",
      SESSION_SECRET: "session-secret",
    });

    expect(receipt.status).toBe("blocked_existing_active_token");
    expect(receipt.active_mcp_token_count).toBe(1);
    expect(calls).toEqual([{ url: "https://gateway.example/api/mcp/tokens", method: "GET" }]);
  });

  it("makes acknowledged existing-token replacement visible in the final pass receipt", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method ?? "GET");
      calls.push({ url, method });
      if (url.endsWith("/api/mcp/tokens") && method === "GET") {
        return new Response(JSON.stringify({ ok: true, tokens: [{ id: "existing", revokedAt: null, scopes: ["base_mcp:governed"] }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/mcp/tokens") && method === "POST") {
        return new Response(JSON.stringify({ ok: true, token: "leo_mcp_live_secret", record: { id: "tok_base" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://gateway.example/mcp/base" && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (body.method === "initialize") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { serverInfo: { name: "leonardo-base-identity-kernel" } } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (body.method === "tools/list") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: BANKR_LIVE_SMOKE_EXPECTED_TOOLS.map((name) => ({ name })) } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (body.method === "tools/call") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                content: [
                  {
                    text: JSON.stringify({
                      ok: true,
                      decision: "allow",
                      tool: "read_wallet_state",
                      result: { provider: "bankr", mode: "read_only" },
                    }),
                  },
                ],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
      }
      if (url.endsWith("/api/mcp/tokens/tok_base") && method === "DELETE") {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    const receipt = await runBankrLiveSmoke({
      BANKR_API_KEY: "bk_live_secret",
      BANKR_LIVE_SMOKE_ENDPOINT: "https://gateway.example/mcp/base",
      BANKR_LIVE_SMOKE_WALLET: "0xaaaa000000000000000000000000000000000001",
      BANKR_LIVE_SMOKE_PASSPORT_ID: "6960",
      BANKR_LIVE_SMOKE_ACK_REVOKES_EXISTING_MCP_TOKEN: "true",
      SESSION_SECRET: "session-secret",
    });

    expect(receipt).toMatchObject({
      status: "pass",
      active_mcp_token_count: 1,
      acknowledged_existing_mcp_token_revocation: true,
    });
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST", "POST", "POST", "POST", "DELETE"]);
  });

  it("uses session auth plus frontend bearer when creating the temporary governed token", async () => {
    const calls: Array<{ url: string; method: string; auth?: string; session?: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: String(init?.method ?? "GET"),
        auth: (init?.headers as Record<string, string> | undefined)?.authorization,
        session: (init?.headers as Record<string, string> | undefined)?.["x-leo-session"],
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify({ ok: true, token: "leo_mcp_live_secret", record: { id: "tok_base" } }), { status: 200, headers: { "content-type": "application/json" } });
    });

    expect(gatewayApiBase("https://gateway.example/mcp/base")).toBe("https://gateway.example");
    process.env.SESSION_SECRET = "session-secret";
    const session = buildSessionToken("0xaaaa000000000000000000000000000000000001", "session-secret", Date.now() + 60_000);
    expect(verifySessionToken(session)).toBe("0xaaaa000000000000000000000000000000000001");

    const created = await requestGatewayBaseMcpToken("https://gateway.example/mcp/base", {
      wallet: "0xaaaa000000000000000000000000000000000001",
      sessionSecret: "session-secret",
      gatewayToken: "gateway-secret",
    });

    expect(created).toEqual({ token: "leo_mcp_live_secret", id: "tok_base" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://gateway.example/api/mcp/tokens",
      method: "POST",
      auth: "Bearer gateway-secret",
      body: { label: "bankr-live-smoke-base", scopes: ["base_mcp:governed"], expiresInDays: 1 },
    });
    expect(verifySessionToken(calls[0]!.session)).toBe("0xaaaa000000000000000000000000000000000001");
  });

  it("treats configured gateway locks as bearer-required", () => {
    expect(shouldRequireGatewayBearer({ BANKR_LIVE_SMOKE_REQUIRE_GATEWAY_TOKEN: "true" })).toBe(true);
    expect(shouldRequireGatewayBearer({ GATEWAY_TOKEN: "configured_elsewhere" })).toBe(true);
    expect(shouldRequireGatewayBearer({})).toBe(false);
  });
});
