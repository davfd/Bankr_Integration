import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = () => readFileSync(join(process.cwd(), "apps/web/app/status/page.tsx"), "utf8");

describe("Status page Bankr readiness copy", () => {
  it("surfaces Bankr rails readiness without claiming live $LEO settlement", () => {
    const source = page();

    expect(source).toContain("Bankr Rails");
    expect(source).toContain("read-only smoke pending");
    expect(source).toContain("receipt_publish");
    expect(source).toContain("x402_payment");
    expect(source).toContain("governed_writes");
    expect(source).toContain("no live $LEO x402 settlement yet");
    expect(source).toContain("Run read-only Bankr smoke");
    expect(source).toContain("last_live_smoke");
    expect(source).toContain("active_mcp_token_count");
    expect(source).toContain("read_wallet_state");
    expect(source).toContain("no Bankr write, no wallet signing, no payment execution");
  });
});
