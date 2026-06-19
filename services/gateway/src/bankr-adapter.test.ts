import { describe, expect, it, vi } from "vitest";
import { createBankrRuntimeAdapter, createBankrRuntimeFromEnv } from "./bankr-adapter";
import type { BaseMcpExecutionInput } from "./mcp-base";

const OWNER = "0xaaaa000000000000000000000000000000000001";
const AGENT = "0xbbbb000000000000000000000000000000000002";
const MERCHANT = "0xcccc000000000000000000000000000000000003";

function capabilityFor(tool: string): BaseMcpExecutionInput["manifest"]["capability"] {
  if (tool === "pay_x402_invoice") return "base.x402.pay";
  if (tool === "publish_receipt_hash") return "base.receipt.publish";
  if (tool === "execute_approved_value_movement") return "base.value.move";
  if (tool === "execute_approved_asset_exchange") return "base.asset.exchange";
  if (tool === "execute_approved_contract_operation") return "base.contract.execute";
  return "base.wallet.read";
}

function riskFor(tool: string): BaseMcpExecutionInput["manifest"]["risk"] {
  if (tool === "pay_x402_invoice") return "spending";
  if (tool === "publish_receipt_hash") return "low_risk_write";
  if (tool === "execute_approved_value_movement" || tool === "execute_approved_asset_exchange" || tool === "execute_approved_contract_operation") return "human_approved_spend";
  return "read_only";
}

function input(tool: string, args: Record<string, unknown> = {}): BaseMcpExecutionInput {
  return {
    tool,
    manifest: {
      name: tool,
      capability: capabilityFor(tool),
      risk: riskFor(tool),
      description: "test manifest",
      inputSchema: {},
    },
    args: { passport_id: "7241", chain_id: 8453, agent_wallet: AGENT, ...args },
    session: {
      wallet: OWNER,
      passport: {
        agent_id: "leonardo-agent-7241",
        passport_id: "7241",
        active_system_prompt_hash: "sha256:test",
        authority_scope: ["answer", "base.wallet.read"],
        risk_context: "tool_execution",
        capability_grants: [{ capability: "base.wallet.read", chain_id: 8453 }],
      },
    },
    grant: { capability: capabilityFor(tool), chain_id: 8453 },
    receipt: { stage: "tool", hash: "sha256:receipt", agent_id: "leonardo-agent-7241", passport_id: "7241", verdict: "allow", reason: "allowed" },
  };
}

function jsonResponse(body: unknown, status = 200): { ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> } {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe("Bankr runtime adapter", () => {
  it("reads wallet state through Bankr read-only endpoints with X-API-Key and sanitized output", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetch = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: init?.headers ?? {} });
      if (url.endsWith("/wallet/me")) return jsonResponse({ address: AGENT, chains: ["base"] });
      if (url.endsWith("/wallet/portfolio?chains=base")) return jsonResponse({ balances: [{ symbol: "LEO", amount: "10" }] });
      return jsonResponse({ error: "unexpected" }, 404);
    });

    const runtime = createBankrRuntimeAdapter({ apiKey: "bk_test_secret", apiBaseUrl: "https://api.bankr.bot", fetch });
    const out = await runtime.readWalletState!(input("read_wallet_state"));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(calls.map((call) => call.url)).toEqual(["https://api.bankr.bot/wallet/me", "https://api.bankr.bot/wallet/portfolio?chains=base"]);
    expect(calls.every((call) => call.headers["X-API-Key"] === "bk_test_secret")).toBe(true);
    expect(JSON.stringify(out)).not.toContain("bk_test_secret");
    expect(out).toMatchObject({
      provider: "bankr",
      mode: "read_only",
      chain: "base",
      wallet: OWNER.toLowerCase(),
      bankr_wallet: { address: AGENT, chains: ["base"] },
      portfolio: { balances: [{ symbol: "LEO", amount: "10" }] },
      receipt_hash: "sha256:receipt",
    });
  });

  it("does not fabricate a runtime when BANKR_API_KEY is absent", () => {
    expect(createBankrRuntimeFromEnv({})).toBeUndefined();
  });

  it("builds a Bankr runtime from env and rejects malformed base URLs or receipt paths", async () => {
    const fetch = vi.fn(async () => jsonResponse({ id: "attestation-env", status: "queued" }));
    const runtime = createBankrRuntimeFromEnv({ BANKR_API_KEY: "bk_env_secret", BANKR_API_BASE_URL: "https://api.bankr.bot", BANKR_RECEIPT_PUBLISH_PATH: "receipts" }, fetch);
    expect(runtime?.readWalletState).toBeTypeOf("function");
    expect(runtime?.payX402Invoice).toBeTypeOf("function");
    expect(runtime?.publishReceiptHash).toBeTypeOf("function");

    const out = await runtime?.publishReceiptHash!(input("publish_receipt_hash", { receipt_hash: "sha256:env-receipt" }));
    expect(fetch).toHaveBeenCalledWith("https://api.bankr.bot/receipts", expect.objectContaining({ method: "POST" }));
    expect(out).toMatchObject({ provider: "bankr", mode: "receipt_publish", endpoint: "/receipts", receipt_hash: "sha256:env-receipt" });

    expect(() => createBankrRuntimeFromEnv({ BANKR_API_KEY: "bk_env_secret", BANKR_API_BASE_URL: "ftp://api.bankr.bot" }, vi.fn())).toThrow(/BANKR_API_BASE_URL/);
    expect(() => createBankrRuntimeFromEnv({ BANKR_API_KEY: "bk_env_secret", BANKR_RECEIPT_PUBLISH_PATH: "https://evil.example/receipts" }, vi.fn())).toThrow(/BANKR_RECEIPT_PUBLISH_PATH/);
    expect(() => createBankrRuntimeFromEnv({ BANKR_API_KEY: "bk_env_secret", BANKR_RECEIPT_PUBLISH_PATH: "../receipts" }, vi.fn())).toThrow(/BANKR_RECEIPT_PUBLISH_PATH/);
  });

  it("keeps x402 payments disabled by default and never calls raw write endpoints", async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const runtime = createBankrRuntimeAdapter({ apiKey: "bk_test_secret", apiBaseUrl: "https://api.bankr.bot", fetch });

    const out = await runtime.payX402Invoice!(input("pay_x402_invoice", {
      recipient: MERCHANT,
      amount: "1",
      asset: "LEO",
      invoice_url: "https://example.com/invoice",
    }));

    expect(out).toMatchObject({ provider: "bankr", mode: "bankr_x402_disabled", executed: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts x402 invoice payments to Bankr only when explicitly enabled and configured", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown; headers: Record<string, string> }> = [];
    const fetch = vi.fn(async (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined, headers: init?.headers ?? {} });
      return jsonResponse({ paymentId: "x402-payment-1", status: "accepted", txHash: "0xx402" });
    });
    const runtime = createBankrRuntimeAdapter({ apiKey: "bk_test_secret", apiBaseUrl: "https://api.bankr.bot", x402PaymentPath: "/x402/pay", enableX402Payments: true, fetch });

    const out = await runtime.payX402Invoice!(input("pay_x402_invoice", {
      recipient: MERCHANT,
      amount: "1.25",
      asset: "LEO",
      chain_id: 8453,
      invoice_url: "https://merchant.example/.well-known/x402/invoice/abc",
      raw_private_log: "SHOULD_NOT_FORWARD",
    }));

    expect(calls).toEqual([{ url: "https://api.bankr.bot/x402/pay", method: "POST", headers: expect.objectContaining({ "X-API-Key": "bk_test_secret", "content-type": "application/json" }), body: {
      recipient: MERCHANT,
      amount: "1.25",
      asset: "LEO",
      chain_id: 8453,
      invoice_url: "https://merchant.example/.well-known/x402/invoice/abc",
      passport_id: "7241",
      agent_id: "leonardo-agent-7241",
      wallet: OWNER.toLowerCase(),
      capability: "base.x402.pay",
      policy_receipt_hash: "sha256:receipt",
    } }]);
    expect(JSON.stringify(calls.map((call) => call.body))).not.toContain("SHOULD_NOT_FORWARD");
    expect(JSON.stringify(out)).not.toContain("bk_test_secret");
    expect(out).toMatchObject({ provider: "bankr", mode: "x402_payment", endpoint: "/x402/pay", executed: true, passport_id: "7241", recipient: MERCHANT, amount: "1.25", asset: "LEO", tx_hash: "0xx402" });
  });

  it("keeps receipt publishing disabled by default", async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const runtime = createBankrRuntimeAdapter({ apiKey: "bk_test_secret", apiBaseUrl: "https://api.bankr.bot", fetch });

    const out = await runtime.publishReceiptHash!(input("publish_receipt_hash", {
      receipt_hash: "sha256:artifact-receipt",
      subject: "bankr-integration-test",
    }));

    expect(out).toMatchObject({ provider: "bankr", mode: "bankr_receipt_publish_disabled", executed: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts hash-only receipt attestations to a configured Bankr receipt endpoint", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown; headers: Record<string, string> }> = [];
    const fetch = vi.fn(async (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined, headers: init?.headers ?? {} });
      return jsonResponse({ id: "attestation-1", status: "queued", receiptHash: "sha256:artifact-receipt" });
    });
    const runtime = createBankrRuntimeAdapter({ apiKey: "bk_test_secret", apiBaseUrl: "https://api.bankr.bot", receiptPublishPath: "/receipts", fetch });

    const out = await runtime.publishReceiptHash!(input("publish_receipt_hash", {
      receipt_hash: "sha256:artifact-receipt",
      subject: "bankr-integration-test",
      raw_private_log: "SHOULD_NOT_FORWARD",
    }));

    expect(calls).toEqual([{ url: "https://api.bankr.bot/receipts", method: "POST", headers: expect.objectContaining({ "X-API-Key": "bk_test_secret", "content-type": "application/json" }), body: {
      receipt_hash: "sha256:artifact-receipt",
      subject: "bankr-integration-test",
      passport_id: "7241",
      agent_id: "leonardo-agent-7241",
      wallet: OWNER.toLowerCase(),
      chain_id: 8453,
      capability: "base.receipt.publish",
      policy_receipt_hash: "sha256:receipt",
    } }]);
    expect(JSON.stringify(calls.map((call) => call.body))).not.toContain("SHOULD_NOT_FORWARD");
    expect(JSON.stringify(calls.map((call) => call.body))).not.toContain("bk_test_secret");
    expect(JSON.stringify(out)).not.toContain("bk_test_secret");
    expect(out).toMatchObject({ provider: "bankr", mode: "receipt_publish", endpoint: "/receipts", executed: true, passport_id: "7241", receipt_hash: "sha256:artifact-receipt", result: { id: "attestation-1", status: "queued" } });
  });

  it("keeps governed Bankr writes disabled by default even after policy approval", async () => {
    const fetch = vi.fn(async () => jsonResponse({ success: true, txHash: "0xabc" }));
    const runtime = createBankrRuntimeAdapter({ apiKey: "bk_test_secret", apiBaseUrl: "https://api.bankr.bot", fetch });

    const out = await runtime.executeApprovedValueMovement!(input("execute_approved_value_movement", {
      recipient: MERCHANT,
      token_address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      amount: "1",
      is_native_token: false,
      human_approval_receipt: "sha256:approved",
    }));

    expect(out).toMatchObject({ provider: "bankr", mode: "bankr_governed_writes_disabled", executed: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts a governed transfer to Bankr only when governed writes are explicitly enabled", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown; headers: Record<string, string> }> = [];
    const fetch = vi.fn(async (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined, headers: init?.headers ?? {} });
      return jsonResponse({ success: true, txHash: "0xabc123" });
    });
    const runtime = createBankrRuntimeAdapter({ apiKey: "bk_test_secret", apiBaseUrl: "https://api.bankr.bot", fetch, enableGovernedWrites: true });

    const out = await runtime.executeApprovedValueMovement!(input("execute_approved_value_movement", {
      recipient: MERCHANT,
      token_address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      amount: "1",
      is_native_token: false,
      human_approval_receipt: "sha256:approved",
    }));

    expect(calls).toEqual([{ url: "https://api.bankr.bot/wallet/transfer", method: "POST", headers: expect.objectContaining({ "X-API-Key": "bk_test_secret", "content-type": "application/json" }), body: { tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", recipientAddress: MERCHANT, amount: "1", isNativeToken: false } }]);
    expect(JSON.stringify(out)).not.toContain("bk_test_secret");
    expect(out).toMatchObject({ provider: "bankr", mode: "governed_write", endpoint: "/wallet/transfer", executed: true, tx_hash: "0xabc123", passport_id: "7241" });
  });

  it("posts a governed asset exchange to Bankr only when governed writes are explicitly enabled", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined });
      return jsonResponse({ success: true, hash: "0xdef456", amountSold: 0.5, amountReceived: 1000 });
    });
    const runtime = createBankrRuntimeAdapter({ apiKey: "bk_test_secret", apiBaseUrl: "https://api.bankr.bot", fetch, enableGovernedWrites: true });

    const out = await runtime.executeApprovedAssetExchange!(input("execute_approved_asset_exchange", {
      from_token: "0x4200000000000000000000000000000000000006",
      to_token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      amount: "0.5",
      min_buy_amount: "1000",
      human_approval_receipt: "sha256:approved",
    }));

    expect(calls).toEqual([{ url: "https://api.bankr.bot/wallet/swap", method: "POST", body: { fromChain: "base", fromToken: "0x4200000000000000000000000000000000000006", toChain: "base", toToken: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount: "0.5", minBuyAmount: "1000" } }]);
    expect(out).toMatchObject({ provider: "bankr", mode: "governed_write", endpoint: "/wallet/swap", executed: true, tx_hash: "0xdef456", passport_id: "7241" });
  });

  it("posts a sealed approved transaction to Bankr submit only when governed writes are explicitly enabled", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown; headers: Record<string, string> }> = [];
    const fetch = vi.fn(async (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined, headers: init?.headers ?? {} });
      return jsonResponse({ success: true, txHash: "0xsubmit789" });
    });
    const runtime = createBankrRuntimeAdapter({ apiKey: "bk_test_secret", apiBaseUrl: "https://api.bankr.bot", fetch, enableGovernedWrites: true });

    const execInput = input("execute_approved_contract_operation", {
      approval_id: "approval-1",
      human_approval_receipt: "sha256:approved-submit",
    });
    execInput.approvedContractOperation = {
      approval_id: "approval-1",
      status: "approved",
      passport_id: "7241",
      chain_id: 8453,
      contract: "0xeeee000000000000000000000000000000000005",
      method: "setAgentURI",
      calldata_hash: "sha256:calldata-approved",
      human_approval_receipt: "sha256:approved-submit",
      approval_hash: "sha256:approval-record",
      nonce: "nonce-approval-1",
      transaction: { chainId: 8453, to: "0xeeee000000000000000000000000000000000005", data: "0x1234deadbeef", value: "0x0" },
    };
    const out = await runtime.executeApprovedContractOperation!(execInput);

    expect(calls).toEqual([{ url: "https://api.bankr.bot/wallet/submit", method: "POST", headers: expect.objectContaining({ "X-API-Key": "bk_test_secret", "content-type": "application/json" }), body: { transaction: { chainId: 8453, to: "0xeeee000000000000000000000000000000000005", data: "0x1234deadbeef", value: "0x0" } } }]);
    expect(JSON.stringify(out)).not.toContain("bk_test_secret");
    expect(JSON.stringify(out)).not.toContain("0x1234deadbeef");
    expect(out).toMatchObject({ provider: "bankr", mode: "governed_write", endpoint: "/wallet/submit", executed: true, tx_hash: "0xsubmit789", passport_id: "7241", approval_id: "approval-1" });
  });

  it("never routes default adapter calls to raw Bankr wallet write or legacy agent endpoints", async () => {
    const calledUrls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      calledUrls.push(url);
      return url.endsWith("/wallet/me")
        ? jsonResponse({ address: AGENT })
        : jsonResponse({ balances: [] });
    });
    const runtime = createBankrRuntimeAdapter({ apiKey: "bk_test_secret", apiBaseUrl: "https://api.bankr.bot", fetch });

    await runtime.readWalletState!(input("read_wallet_state"));
    await runtime.payX402Invoice!(input("pay_x402_invoice", { recipient: MERCHANT, amount: "1", invoice_url: "https://example.com" }));
    await runtime.publishReceiptHash!(input("publish_receipt_hash", { receipt_hash: "sha256:abc" }));
    await runtime.executeApprovedValueMovement!(input("execute_approved_value_movement", { recipient: MERCHANT, token_address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount: "1", is_native_token: false, human_approval_receipt: "sha256:approved" }));
    await runtime.executeApprovedAssetExchange!(input("execute_approved_asset_exchange", { from_token: "0x4200000000000000000000000000000000000006", to_token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount: "0.5", min_buy_amount: "1000", human_approval_receipt: "sha256:approved" }));
    const execInput = input("execute_approved_contract_operation", { approval_id: "approval-1", human_approval_receipt: "sha256:approved-submit" });
    execInput.approvedContractOperation = { approval_id: "approval-1", status: "approved", passport_id: "7241", chain_id: 8453, contract: "0xeeee000000000000000000000000000000000005", method: "setAgentURI", calldata_hash: "sha256:calldata-approved", human_approval_receipt: "sha256:approved-submit", approval_hash: "sha256:approval-record", nonce: "nonce-approval-1", transaction: { chainId: 8453, to: "0xeeee000000000000000000000000000000000005", data: "0x1234deadbeef", value: "0x0" } };
    await runtime.executeApprovedContractOperation!(execInput);

    expect(calledUrls.join("\n")).not.toMatch(/\/wallet\/(sign|submit|transfer|swap)(\b|\?)/);
    expect(calledUrls.join("\n")).not.toMatch(/\/agent\//);
  });
});
