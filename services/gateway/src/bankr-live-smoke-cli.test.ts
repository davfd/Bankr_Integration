import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runBankrLiveSmokeCli, safeBankrLiveSmokeJson } from "./bankr-live-smoke";

describe("Bankr live-smoke CLI", () => {
  it("supports a non-mutating --preflight mode that returns a ready_not_run receipt", async () => {
    const { receipt, exitCode } = await runBankrLiveSmokeCli({
      args: ["--preflight"],
      env: {
        BANKR_API_KEY: "bk_live_secret_that_must_not_print",
        BANKR_LIVE_SMOKE_ENDPOINT: "https://leo-gw.example.test/mcp/base",
        BANKR_LIVE_SMOKE_WALLET: "0xaaaa000000000000000000000000000000000001",
        BANKR_LIVE_SMOKE_PASSPORT_ID: "6960",
        BANKR_RECEIPT_PUBLISH_PATH: "/receipts",
        BANKR_X402_PAYMENTS_ENABLED: "true",
        BANKR_X402_PAYMENT_PATH: "/x402/pay",
        SESSION_SECRET: "session_secret_that_must_not_print",
      },
    });

    expect(exitCode).toBe(0);
    expect(receipt).toMatchObject({
      ready: false,
      status: "ready_not_run",
      readiness_mode: "read_only",
      blocked_reason: "Bankr live smoke config is present but has not been executed",
      acknowledged_existing_mcp_token_revocation: false,
      revoked_token: false,
      receipt_publish: { configured: true, ready: true, endpoint_path: "/receipts" },
      x402_payment: { requested: true, configured: true, ready: true, endpoint_path: "/x402/pay" },
    });
    const json = safeBankrLiveSmokeJson(receipt);
    expect(json).not.toContain("bk_live_secret_that_must_not_print");
    expect(json).not.toContain("session_secret_that_must_not_print");
  });

  it("exposes node-runnable Bankr smoke package scripts without requiring bun or tsx", () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { scripts?: Record<string, string> };

    expect(pkg.scripts?.["bankr:smoke:preflight"]).toContain("node --loader ./scripts/node-esm-extension-loader.mjs");
    expect(pkg.scripts?.["bankr:smoke:preflight"]).toContain("--preflight");
    expect(pkg.scripts?.["bankr:smoke:live"]).toContain("node --loader ./scripts/node-esm-extension-loader.mjs");
    expect(pkg.scripts?.["bankr:smoke:live"]).not.toContain("bun");
    expect(pkg.scripts?.["bankr:smoke:live"]).not.toContain("tsx");
  });
});
