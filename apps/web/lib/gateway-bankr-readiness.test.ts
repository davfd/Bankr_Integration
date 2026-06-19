import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBankrReadiness, runBankrLiveSmoke } from "./gateway";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Bankr readiness gateway client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fetches safe Bankr readiness fields from the gateway without requiring live Bankr calls", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: string, init?: RequestInit) => {
      calls.push({ input, init });
      return jsonResponse({
        ok: true,
        bankr: {
          configured: true,
          mode: "read_only",
          api_base_url: "https://api.bankr.bot",
          governed_writes: { requested: false, ready: false, reason: "BANKR_GOVERNED_WRITES_ENABLED is not true" },
          receipt_publish: { configured: true, ready: true, reason: "BANKR_RECEIPT_PUBLISH_PATH configured", endpoint_path: "/receipts" },
          x402_payment: { requested: true, configured: true, ready: true, reason: "BANKR_X402 payment path configured", endpoint_path: "/x402/pay" },
        },
      });
    };

    const readiness = await fetchBankrReadiness({ fetchImpl });

    expect(calls[0]?.input).toContain("/api/bankr/readiness");
    expect(readiness.mode).toBe("read_only");
    expect(readiness.receipt_publish?.endpoint_path).toBe("/receipts");
    expect(readiness.x402_payment?.endpoint_path).toBe("/x402/pay");
    expect(JSON.stringify(readiness)).not.toMatch(/bk_|Bearer|x-api-key|secret/i);
  });

  it("posts an operator-triggered Bankr live-smoke request and returns only the sanitized receipt", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: string, init?: RequestInit) => {
      calls.push({ input, init });
      return jsonResponse({
        ok: true,
        bankr_live_smoke: {
          ready: true,
          status: "pass",
          readiness_mode: "read_only",
          active_mcp_token_count: 0,
          has_expected_wrappers: true,
          has_raw_write_tool: false,
          read_payload_ok: true,
          read_decision: "allow",
          read_tool: "read_wallet_state",
          result_provider: "bankr",
          result_mode: "read_only",
          revoked_token: true,
        },
      });
    };

    const receipt = await runBankrLiveSmoke({ fetchImpl });

    expect(calls[0]?.input).toContain("/api/bankr/live-smoke");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.cache).toBe("no-store");
    expect(receipt.status).toBe("pass");
    expect(receipt.active_mcp_token_count).toBe(0);
    expect(receipt.read_tool).toBe("read_wallet_state");
    expect(receipt.result_provider).toBe("bankr");
    expect(receipt.has_raw_write_tool).toBe(false);
    expect(JSON.stringify(receipt)).not.toMatch(/bk_|Bearer|x-api-key|secret/i);
  });
});
