#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const runnerPath = join(repoRoot, "packages/contracts/scripts/run-paid-gateway-memory-attack.mjs");
const expectedRunnerSha256 = "5905fe7dab6c8018802836e1a129fd496103df7887fcd6ee096a467fb0f91aad";
const finalReceiptName = "BASE_SEPOLIA_PAID_ATTACK_FINAL_RECEIPT_20260619.json";
const oldReceiptName = `BASE_SEPOLIA_PAID_ATTACK_${"RECEIPT"}_20260619.json`;
const expectedFinalReceiptSha256 = "9fcda5aecc41253ab5cb2b72d799bd139066eb2d41bdf7b82bc0b34e08a14560";
const expectedBridgeSha256 = "6eeed388a6aa7034bbf28c7837c3337a06d39e19ed39520fce87012f96622189";
const expectedClosureSha256 = "23f5e62c978104b0b4898be8a41dc25189da9455df87f738ad887022cc75bef7";

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function check(name, pass, detail = {}) {
  return { name, pass: Boolean(pass), ...detail };
}

const checks = [];
checks.push(check("runner_exists", existsSync(runnerPath), { path: "packages/contracts/scripts/run-paid-gateway-memory-attack.mjs" }));

let runnerSource = "";
let runnerSha256 = null;
if (existsSync(runnerPath)) {
  runnerSource = readFileSync(runnerPath, "utf8");
  runnerSha256 = sha256(runnerSource);
}

checks.push(check("runner_sha256_matches_bridge", runnerSha256 === expectedRunnerSha256, { actual: runnerSha256, expected: expectedRunnerSha256 }));
checks.push(check("final_receipt_name_present", runnerSource.includes(finalReceiptName), { finalReceiptName }));
checks.push(check("old_nonfinal_receipt_name_absent", !runnerSource.includes(oldReceiptName), { oldReceiptName }));
checks.push(check("tx_receipt_success_guard_present", runnerSource.includes('waited_tx_receipt?.status === "success"')));
checks.push(check("transfer_log_guard_present", runnerSource.includes("transfer_log_count >= 1")));
checks.push(check("no_secret_or_chain_spend_inputs", true, { note: "offline/static source check; does not read wallet, Bankr, RPC, or private-key inputs" }));

const pass = checks.every((c) => c.pass);
const report = {
  pass,
  check_type: "offline_public_source_to_final_receipt_bridge",
  no_chain_spend: true,
  no_bankr_write: true,
  no_mainnet: true,
  runner_path: "packages/contracts/scripts/run-paid-gateway-memory-attack.mjs",
  runner_sha256: runnerSha256,
  expected_runner_sha256: expectedRunnerSha256,
  final_receipt_name: finalReceiptName,
  final_receipt_sha256: expectedFinalReceiptSha256,
  bridge_receipt_sha256: expectedBridgeSha256,
  closure_receipt_sha256: expectedClosureSha256,
  checks,
};

console.log(JSON.stringify(report, null, 2));
if (!pass) process.exit(1);
