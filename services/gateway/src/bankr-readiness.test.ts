import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { bankrReadinessFromEnv, safeBankrReceiptJson } from "./bankr-readiness";
import type { BaseMcpExecutionInput } from "./mcp-base";

const STRONG_TEST_SIGNING_SECRET = "hmac_secret_0123456789_0123456789";

function valueMovementInput(): BaseMcpExecutionInput {
  return {
    tool: "execute_approved_value_movement",
    manifest: { name: "execute_approved_value_movement", capability: "base.value.move", risk: "human_approved_spend", description: "test", inputSchema: {} },
    args: { passport_id: "7241", chain_id: 8453, recipient: "0xcccc000000000000000000000000000000000003", token_address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount: "1", is_native_token: false, human_approval_receipt: "sha256:approved" },
    session: { wallet: "0xaaaa000000000000000000000000000000000001", passport: { agent_id: "agent", passport_id: "7241", active_system_prompt_hash: "sha256:test", authority_scope: ["base.value.move"] } },
    grant: { capability: "base.value.move", chain_id: 8453 },
    receipt: { stage: "tool", hash: "sha256:receipt", agent_id: "agent", passport_id: "7241", verdict: "allow", reason: "allowed" },
  };
}

function runtimeInput(tool: string, capability: string, args: Record<string, unknown>): BaseMcpExecutionInput {
  return {
    tool,
    manifest: { name: tool, capability, risk: "test", description: "test", inputSchema: {} },
    args: { passport_id: "7241", chain_id: 8453, ...args },
    session: { wallet: "0xaaaa000000000000000000000000000000000001", passport: { agent_id: "agent", passport_id: "7241", active_system_prompt_hash: "sha256:test", authority_scope: [capability] } },
    grant: { capability, chain_id: 8453 },
    receipt: { stage: "tool", hash: "sha256:receipt", agent_id: "agent", passport_id: "7241", verdict: "allow", reason: "allowed" },
  };
}

describe("Bankr runtime readiness", () => {
  it("fails closed when BANKR_API_KEY is absent", () => {
    const out = bankrReadinessFromEnv({});

    expect(out.runtime).toBeUndefined();
    expect(out.receipt).toMatchObject({ configured: false, mode: "disabled", reason: "BANKR_API_KEY missing" });
    expect(JSON.stringify(out.receipt)).not.toMatch(/authorization|bearer|x-api-key/i);
  });

  it("installs a read-only runtime when BANKR_API_KEY is present without returning the key", () => {
    const fetch = vi.fn();
    const out = bankrReadinessFromEnv({ BANKR_API_KEY: "bk_live_secret", BANKR_API_BASE_URL: "https://api.bankr.bot" }, fetch);

    expect(out.runtime?.readWalletState).toBeTypeOf("function");
    expect(out.receipt).toMatchObject({
      configured: true,
      mode: "read_only",
      api_base_url: "https://api.bankr.bot",
      receipt_publish: { configured: false, ready: false, reason: "BANKR_RECEIPT_PUBLISH_PATH is not set" },
      x402_payment: { requested: false, configured: false, ready: false, reason: "BANKR_X402_PAYMENTS_ENABLED is not true" },
    });
    expect(safeBankrReceiptJson(out)).not.toContain("bk_live_secret");
    expect(safeBankrReceiptJson(out)).not.toMatch(/X-API-Key|Authorization: Bearer/i);
  });

  it("reports receipt/x402 adapter config and wires it into the runtime without leaking keys", async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const fetch = vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      return { ok: true, status: 200, json: async () => ({ id: "ok", txHash: "0xx402" }), text: async () => "{}" };
    });
    const out = bankrReadinessFromEnv({
      BANKR_API_KEY: "bk_live_secret",
      BANKR_API_BASE_URL: "https://api.bankr.bot",
      BANKR_RECEIPT_PUBLISH_PATH: "receipts",
      BANKR_X402_PAYMENTS_ENABLED: "true",
      BANKR_X402_PAYMENT_PATH: "/x402/pay",
    }, fetch);

    expect(out.receipt).toMatchObject({
      configured: true,
      mode: "read_only",
      receipt_publish: { configured: true, ready: true, reason: "BANKR_RECEIPT_PUBLISH_PATH configured", endpoint_path: "/receipts" },
      x402_payment: { requested: true, configured: true, ready: true, reason: "BANKR_X402 payment path configured", endpoint_path: "/x402/pay" },
    });

    await out.runtime!.publishReceiptHash!(runtimeInput("publish_receipt_hash", "base.receipt.publish", { receipt_hash: "sha256:artifact" }));
    await out.runtime!.payX402Invoice!(runtimeInput("pay_x402_invoice", "base.x402.pay", { recipient: "0xcccc000000000000000000000000000000000003", amount: "1", asset: "LEO", invoice_url: "https://merchant.example/invoice" }));

    expect(calls.map((call) => call.url)).toEqual(["https://api.bankr.bot/receipts", "https://api.bankr.bot/x402/pay"]);
    expect(JSON.stringify(calls.map((call) => call.body))).not.toContain("bk_live_secret");
    expect(safeBankrReceiptJson(out)).not.toContain("bk_live_secret");
  });

  it("reports invalid receipt/x402 adapter paths without installing a runtime or leaking env values", () => {
    const badReceipt = bankrReadinessFromEnv({ BANKR_API_KEY: "bk_live_secret", BANKR_RECEIPT_PUBLISH_PATH: "https://evil.example/receipts" }, vi.fn());
    expect(badReceipt.runtime).toBeUndefined();
    expect(badReceipt.receipt).toMatchObject({ configured: false, mode: "invalid_config", reason: "BANKR_RECEIPT_PUBLISH_PATH invalid" });
    expect(safeBankrReceiptJson(badReceipt)).not.toContain("bk_live_secret");
    expect(safeBankrReceiptJson(badReceipt)).not.toContain("https://evil.example/receipts");

    const badX402 = bankrReadinessFromEnv({ BANKR_API_KEY: "bk_live_secret", BANKR_X402_PAYMENTS_ENABLED: "true", BANKR_X402_PAYMENT_PATH: "../x402/pay" }, vi.fn());
    expect(badX402.runtime).toBeUndefined();
    expect(badX402.receipt).toMatchObject({ configured: false, mode: "invalid_config", reason: "BANKR_X402_PAYMENT_PATH invalid" });
    expect(safeBankrReceiptJson(badX402)).not.toContain("bk_live_secret");
    expect(safeBankrReceiptJson(badX402)).not.toContain("../x402/pay");
  });

  it("treats governed-write enablement as blocked until Approval Authority env is complete", async () => {
    const input = valueMovementInput();

    const disabledFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, txHash: "0xabc" }), text: async () => "{}" }));
    const disabled = bankrReadinessFromEnv({ BANKR_API_KEY: "bk_live_secret", BANKR_API_BASE_URL: "https://api.bankr.bot" }, disabledFetch);
    const disabledOut = await disabled.runtime!.executeApprovedValueMovement!(input);
    expect(disabled.receipt).toMatchObject({
      configured: true,
      mode: "read_only",
      governed_writes: { requested: false, ready: false, reason: "BANKR_GOVERNED_WRITES_ENABLED is not true" },
    });
    expect(disabledOut).toMatchObject({ mode: "bankr_governed_writes_disabled", executed: false });
    expect(disabledFetch).not.toHaveBeenCalled();

    const requestedFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, txHash: "0xabc" }), text: async () => "{}" }));
    const requested = bankrReadinessFromEnv({ BANKR_API_KEY: "bk_live_secret", BANKR_API_BASE_URL: "https://api.bankr.bot", BANKR_GOVERNED_WRITES_ENABLED: "true" }, requestedFetch);
    const requestedOut = await requested.runtime!.executeApprovedValueMovement!(input);
    expect(requested.receipt).toMatchObject({
      configured: true,
      mode: "read_only",
      governed_writes: {
        requested: true,
        ready: false,
        reason: "Approval Authority env incomplete",
        missing_env: ["BANKR_APPROVAL_STORE_PATH", "BANKR_APPROVAL_USAGE_STORE_PATH", "BANKR_APPROVAL_AUDIT_LOG_PATH", "BANKR_APPROVAL_SIGNING_SECRET"],
      },
    });
    expect(requestedOut).toMatchObject({ mode: "bankr_governed_writes_disabled", executed: false });
    expect(requestedFetch).not.toHaveBeenCalled();
    expect(safeBankrReceiptJson(requested)).not.toContain("bk_live_secret");

    const enabledFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, txHash: "0xabc" }), text: async () => "{}" }));
    const enabledRoot = mkdtempSync(join(tmpdir(), "bankr-readiness-enabled-"));
    try {
      const enabled = bankrReadinessFromEnv({
        BANKR_API_KEY: "bk_live_secret",
        BANKR_API_BASE_URL: "https://api.bankr.bot",
        BANKR_GOVERNED_WRITES_ENABLED: "true",
        BANKR_APPROVAL_STORE_PATH: join(enabledRoot, "approvals", "approvals.json"),
        BANKR_APPROVAL_USAGE_STORE_PATH: join(enabledRoot, "usage"),
        BANKR_APPROVAL_AUDIT_LOG_PATH: join(enabledRoot, "audit", "audit.jsonl"),
        BANKR_APPROVAL_SIGNING_SECRET: STRONG_TEST_SIGNING_SECRET,
      }, enabledFetch);
      const enabledOut = await enabled.runtime!.executeApprovedValueMovement!(input);
      expect(enabled.receipt).toMatchObject({
        configured: true,
        mode: "read_only",
        governed_writes: { requested: true, ready: true, reason: "Approval Authority env complete" },
      });
      expect(enabledOut).toMatchObject({ mode: "governed_write", endpoint: "/wallet/transfer", tx_hash: "0xabc" });
      expect(enabledFetch).toHaveBeenCalledTimes(1);
      expect(safeBankrReceiptJson(enabled)).not.toContain(STRONG_TEST_SIGNING_SECRET);
    } finally {
      rmSync(enabledRoot, { recursive: true, force: true });
    }
  });

  it("blocks governed writes when Approval Authority path preflight fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "bankr-readiness-bad-path-"));
    try {
      const usagePathCollision = join(root, "usage-is-a-file");
      writeFileSync(usagePathCollision, "not a directory", "utf8");
      const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, txHash: "0xabc" }), text: async () => "{}" }));
      const out = bankrReadinessFromEnv({
        BANKR_API_KEY: "bk_live_secret",
        BANKR_API_BASE_URL: "https://api.bankr.bot",
        BANKR_GOVERNED_WRITES_ENABLED: "true",
        BANKR_APPROVAL_STORE_PATH: join(root, "approvals", "approvals.json"),
        BANKR_APPROVAL_USAGE_STORE_PATH: usagePathCollision,
        BANKR_APPROVAL_AUDIT_LOG_PATH: join(root, "audit", "audit.jsonl"),
        BANKR_APPROVAL_SIGNING_SECRET: STRONG_TEST_SIGNING_SECRET,
      }, fetch);

      expect(out.receipt).toMatchObject({
        configured: true,
        mode: "read_only",
        governed_writes: {
          requested: true,
          ready: false,
          reason: "Approval Authority preflight failed",
          failed_preflight: [expect.objectContaining({ env: "BANKR_APPROVAL_USAGE_STORE_PATH", check: "writable_directory" })],
        },
      });
      const result = await out.runtime!.executeApprovedValueMovement!(valueMovementInput());
      expect(result).toMatchObject({ mode: "bankr_governed_writes_disabled", executed: false });
      expect(fetch).not.toHaveBeenCalled();
      expect(safeBankrReceiptJson(out)).not.toContain(STRONG_TEST_SIGNING_SECRET);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks governed writes when the Approval Authority signing secret is too weak", () => {
    const root = mkdtempSync(join(tmpdir(), "bankr-readiness-weak-secret-"));
    try {
      const out = bankrReadinessFromEnv({
        BANKR_API_KEY: "bk_live_secret",
        BANKR_API_BASE_URL: "https://api.bankr.bot",
        BANKR_GOVERNED_WRITES_ENABLED: "true",
        BANKR_APPROVAL_STORE_PATH: join(root, "approvals", "approvals.json"),
        BANKR_APPROVAL_USAGE_STORE_PATH: join(root, "usage"),
        BANKR_APPROVAL_AUDIT_LOG_PATH: join(root, "audit", "audit.jsonl"),
        BANKR_APPROVAL_SIGNING_SECRET: "short_secret",
      }, vi.fn());

      expect(out.receipt).toMatchObject({
        configured: true,
        mode: "read_only",
        governed_writes: {
          requested: true,
          ready: false,
          reason: "Approval Authority preflight failed",
          failed_preflight: [expect.objectContaining({ env: "BANKR_APPROVAL_SIGNING_SECRET", check: "min_length_32" })],
        },
      });
      expect(safeBankrReceiptJson(out)).not.toContain("short_secret");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports invalid BANKR_API_BASE_URL as blocked configuration without leaking env values", () => {
    const out = bankrReadinessFromEnv({ BANKR_API_KEY: "bk_live_secret", BANKR_API_BASE_URL: "ftp://secret.invalid" }, vi.fn());

    expect(out.runtime).toBeUndefined();
    expect(out.receipt).toMatchObject({ configured: false, mode: "invalid_config", reason: "BANKR_API_BASE_URL invalid" });
    const json = safeBankrReceiptJson(out);
    expect(json).not.toContain("bk_live_secret");
    expect(json).not.toContain("ftp://secret.invalid");
  });

  it("redacts Bankr keys, MCP tokens, session headers, and auth headers from receipts", () => {
    const json = safeBankrReceiptJson({
      BANKR_API_KEY: "bk_live_secret",
      token: "leo_mcp_very_secret",
      "x-leo-session": "session.secret.payload",
      Authorization: "Bearer gateway_secret",
      "X-API-Key": "bk_header_secret",
      BANKR_APPROVAL_SIGNING_SECRET: STRONG_TEST_SIGNING_SECRET,
    });

    expect(json).not.toContain("bk_live_secret");
    expect(json).not.toContain("leo_mcp_very_secret");
    expect(json).not.toContain("session.secret.payload");
    expect(json).not.toContain("gateway_secret");
    expect(json).not.toContain(STRONG_TEST_SIGNING_SECRET);
    expect(json).toContain("[REDACTED]");
  });
});
