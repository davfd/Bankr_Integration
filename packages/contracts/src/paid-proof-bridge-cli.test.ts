import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const repoFile = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("paid x402 proof bridge CLI", () => {
  it("exposes a deterministic no-spend public proof bridge check", () => {
    const pkg = JSON.parse(repoFile("package.json")) as { scripts?: Record<string, string> };
    const scriptPath = "scripts/verify-paid-proof-bridge.mjs";

    expect(existsSync(join(process.cwd(), scriptPath))).toBe(true);
    expect(pkg.scripts?.["bankr:proof:bridge"]).toBe(`node ${scriptPath}`);

    const source = repoFile(scriptPath);
    expect(source).toContain("BASE_SEPOLIA_PAID_ATTACK_FINAL_RECEIPT_20260619.json");
    expect(source).not.toContain("BASE_SEPOLIA_PAID_ATTACK_RECEIPT_20260619.json");
    expect(source).toContain("waited_tx_receipt?.status === \"success\"");
    expect(source).toContain("transfer_log_count >= 1");
    expect(source).toContain("5905fe7dab6c8018802836e1a129fd496103df7887fcd6ee096a467fb0f91aad");
    expect(source).toContain("9fcda5aecc41253ab5cb2b72d799bd139066eb2d41bdf7b82bc0b34e08a14560");
    expect(source).not.toMatch(/process\.env/);
  });

  it("documents the no-spend bridge check in the README", () => {
    const readme = repoFile("README.md");
    expect(readme).toContain("pnpm bankr:proof:bridge");
    expect(readme).toContain("offline/no-spend");
    expect(readme).toContain("public-source → final-receipt provenance");
    expect(readme).toContain("proof-bridge.yml");
  });

  it("runs the public proof bridge in CI without secrets, installs, RPC, or spend", () => {
    const workflowPath = ".github/workflows/proof-bridge.yml";
    expect(existsSync(join(process.cwd(), workflowPath))).toBe(true);

    const workflow = repoFile(workflowPath);
    expect(workflow).toContain("name: Paid proof bridge");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("permissions:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("node scripts/verify-paid-proof-bridge.mjs");
    expect(workflow).not.toMatch(/secrets\.|process\.env|env:|pnpm install|npm install|yarn install|BANKR|PRIVATE_KEY|RPC|x402|mainnet/i);
  });
});
