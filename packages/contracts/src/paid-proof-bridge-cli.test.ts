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

  it("binds a self-contained public final receipt fixture to the no-spend verifier", () => {
    const proofPath = "proofs/BASE_SEPOLIA_PAID_ATTACK_FINAL_RECEIPT_20260619.json";
    expect(existsSync(join(process.cwd(), proofPath))).toBe(true);

    const receiptText = repoFile(proofPath);
    const receipt = JSON.parse(receiptText) as {
      pass?: boolean;
      network?: string;
      payer?: string;
      payTo?: string;
      payer_equals_payTo?: boolean;
      no_mainnet?: boolean;
      no_bankr_write?: boolean;
      no_leo_movement?: boolean;
      no_production_deploy?: boolean;
      no_authority_graph_mutation?: boolean;
      malicious_check?: { dlp_blocked?: boolean; raw_secret_in_response?: boolean; raw_secret_in_memory?: boolean; memory_records_after_malicious?: number };
      clean_paid_capture_check?: {
        ok?: boolean;
        memory_records_after_clean?: number;
        witness_metadata?: { authority_class?: string; writer_path?: string; bankr_write_authority?: boolean; leo_movement_authority?: boolean; leonardo_graph_write_authority?: boolean };
        payment_response?: { transaction?: string; network?: string };
        chain?: { transfer_log_count?: number; logs?: Array<{ tx_hash?: string; value_raw?: string; from?: string; to?: string }>; tx_receipt?: { status?: string; tx_hash?: string } };
      };
    };

    expect(receipt.pass).toBe(true);
    expect(receipt.network).toBe("base-sepolia");
    expect(receipt.payer_equals_payTo).toBe(false);
    expect(receipt.no_mainnet).toBe(true);
    expect(receipt.no_bankr_write).toBe(true);
    expect(receipt.no_leo_movement).toBe(true);
    expect(receipt.no_production_deploy).toBe(true);
    expect(receipt.no_authority_graph_mutation).toBe(true);
    expect(receipt.malicious_check).toMatchObject({
      dlp_blocked: true,
      raw_secret_in_response: false,
      raw_secret_in_memory: false,
      memory_records_after_malicious: 0,
    });
    expect(receipt.clean_paid_capture_check?.witness_metadata).toMatchObject({
      writer_path: "council-gateway",
      authority_class: "witness_only",
      bankr_write_authority: false,
      leo_movement_authority: false,
      leonardo_graph_write_authority: false,
    });
    expect(receipt.clean_paid_capture_check?.chain?.tx_receipt?.status).toBe("success");
    expect(receipt.clean_paid_capture_check?.chain?.transfer_log_count).toBeGreaterThanOrEqual(1);
    expect(receipt.clean_paid_capture_check?.chain?.logs?.[0]?.value_raw).toBe("50000");
    expect(receipt.clean_paid_capture_check?.chain?.logs?.[0]?.from).toBe(receipt.payer);
    expect(receipt.clean_paid_capture_check?.chain?.logs?.[0]?.to).toBe(receipt.payTo);
    expect(receipt.clean_paid_capture_check?.chain?.logs?.[0]?.tx_hash).toBe(receipt.clean_paid_capture_check?.payment_response?.transaction);
    expect(receipt.clean_paid_capture_check?.chain?.tx_receipt?.tx_hash).toBe(receipt.clean_paid_capture_check?.payment_response?.transaction);
    expect(receiptText).not.toMatch(/bk_test_should_never_appear|CANARY_PAID_X402|0x2222222222222222222222222222222222222222222222222222222222222222/);

    const verifier = repoFile("scripts/verify-paid-proof-bridge.mjs");
    expect(verifier).toContain(proofPath);
    expect(verifier).toContain("receipt_sha256_matches_expected");
    expect(verifier).toContain("receipt_payment_log_tx_matches_payment_response");
    expect(verifier).toContain("receipt_payment_parties_match_top_level");
    expect(verifier).toContain("receipt_witness_metadata_fail_closed");
  });
});
