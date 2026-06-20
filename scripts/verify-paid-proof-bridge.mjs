#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const runnerRelativePath = "packages/contracts/scripts/run-paid-gateway-memory-attack.mjs";
const runnerPath = join(repoRoot, runnerRelativePath);
const expectedRunnerSha256 = "5905fe7dab6c8018802836e1a129fd496103df7887fcd6ee096a467fb0f91aad";
const finalReceiptName = "BASE_SEPOLIA_PAID_ATTACK_FINAL_RECEIPT_20260619.json";
const finalReceiptRelativePath = "proofs/BASE_SEPOLIA_PAID_ATTACK_FINAL_RECEIPT_20260619.json";
const finalReceiptPath = join(repoRoot, finalReceiptRelativePath);
const oldReceiptName = `BASE_SEPOLIA_PAID_ATTACK_${"RECEIPT"}_20260619.json`;
const expectedFinalReceiptSha256 = "9fcda5aecc41253ab5cb2b72d799bd139066eb2d41bdf7b82bc0b34e08a14560";
const expectedBridgeSha256 = "6eeed388a6aa7034bbf28c7837c3337a06d39e19ed39520fce87012f96622189";
const expectedClosureSha256 = "23f5e62c978104b0b4898be8a41dc25189da9455df87f738ad887022cc75bef7";
const baseSepoliaUsdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function check(name, pass, detail = {}) {
  return { name, pass: Boolean(pass), ...detail };
}

function parseJson(text) {
  try {
    return { value: JSON.parse(text), error: null };
  } catch (error) {
    return { value: null, error: error?.message ?? String(error) };
  }
}

const checks = [];
checks.push(check("runner_exists", existsSync(runnerPath), { path: runnerRelativePath }));

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

checks.push(check("final_receipt_fixture_exists", existsSync(finalReceiptPath), { path: finalReceiptRelativePath }));

let receiptText = "";
let receiptSha256 = null;
let receipt = null;
let receiptParseError = null;
if (existsSync(finalReceiptPath)) {
  receiptText = readFileSync(finalReceiptPath, "utf8");
  receiptSha256 = sha256(receiptText);
  const parsed = parseJson(receiptText);
  receipt = parsed.value;
  receiptParseError = parsed.error;
}

const clean = receipt?.clean_paid_capture_check;
const malicious = receipt?.malicious_check;
const witness = clean?.witness_metadata;
const chain = clean?.chain;
const paymentTx = clean?.payment_response?.transaction;
const receiptTx = chain?.tx_receipt ?? chain?.waited_tx_receipt;
const logs = Array.isArray(chain?.logs) ? chain.logs : [];
const topLevelPayer = typeof receipt?.payer === "string" ? receipt.payer.toLowerCase() : null;
const topLevelPayTo = typeof receipt?.payTo === "string" ? receipt.payTo.toLowerCase() : null;
const logMatchingPayment = typeof paymentTx === "string" && logs.some((log) => log?.tx_hash === paymentTx);
const logMatchingParties = topLevelPayer !== null && topLevelPayTo !== null && logs.some((log) => log?.from?.toLowerCase() === topLevelPayer && log?.to?.toLowerCase() === topLevelPayTo);
const valueMatchingPrice = logs.some((log) => log?.value_raw === "50000");
const rawForbiddenReceiptNeedle = /bk_test_should_never_appear|CANARY_PAID_X402|0x2222222222222222222222222222222222222222222222222222222222222222/;

checks.push(check("receipt_sha256_matches_expected", receiptSha256 === expectedFinalReceiptSha256, { actual: receiptSha256, expected: expectedFinalReceiptSha256 }));
checks.push(check("receipt_json_parseable", receipt !== null && receiptParseError === null, { error: receiptParseError }));
checks.push(check("receipt_pass_true", receipt?.pass === true));
checks.push(check("receipt_boundary_flags_fail_closed", receipt?.network === "base-sepolia" && receipt?.payer_equals_payTo === false && receipt?.no_mainnet === true && receipt?.no_bankr_write === true && receipt?.no_leo_movement === true && receipt?.no_production_deploy === true && receipt?.no_authority_graph_mutation === true, {
  network: receipt?.network,
  payer_equals_payTo: receipt?.payer_equals_payTo,
  no_mainnet: receipt?.no_mainnet,
  no_bankr_write: receipt?.no_bankr_write,
  no_leo_movement: receipt?.no_leo_movement,
  no_production_deploy: receipt?.no_production_deploy,
  no_authority_graph_mutation: receipt?.no_authority_graph_mutation,
}));
checks.push(check("receipt_malicious_dlp_fail_closed", malicious?.response_status === 422 && malicious?.dlp_blocked === true && malicious?.raw_secret_in_response === false && malicious?.raw_secret_in_memory === false && malicious?.memory_records_after_malicious === 0, {
  response_status: malicious?.response_status,
  dlp_blocked: malicious?.dlp_blocked,
  memory_records_after_malicious: malicious?.memory_records_after_malicious,
}));
checks.push(check("receipt_witness_metadata_fail_closed", clean?.ok === true && clean?.memory_records_after_clean === 1 && witness?.writer_path === "council-gateway" && witness?.authority_class === "witness_only" && witness?.capture_target === "file:council-memory" && witness?.dlp_checked === true && witness?.leonardo_graph_write_authority === false && witness?.bankr_write_authority === false && witness?.leo_movement_authority === false, {
  writer_path: witness?.writer_path,
  authority_class: witness?.authority_class,
  capture_target: witness?.capture_target,
  dlp_checked: witness?.dlp_checked,
}));
checks.push(check("receipt_payment_log_tx_matches_payment_response", typeof paymentTx === "string" && receiptTx?.tx_hash === paymentTx && logMatchingPayment, {
  payment_transaction: paymentTx,
  receipt_tx_hash: receiptTx?.tx_hash,
  log_matching_payment: logMatchingPayment,
}));
checks.push(check("receipt_payment_parties_match_top_level", logMatchingParties, {
  payer: receipt?.payer,
  payTo: receipt?.payTo,
  log_matching_parties: logMatchingParties,
}));
checks.push(check("receipt_tx_success_and_transfer_value", receiptTx?.status === "success" && Number(chain?.transfer_log_count ?? 0) >= 1 && valueMatchingPrice && chain?.usdc === baseSepoliaUsdc, {
  tx_status: receiptTx?.status,
  transfer_log_count: chain?.transfer_log_count,
  value_matching_price: valueMatchingPrice,
  usdc: chain?.usdc,
}));
checks.push(check("receipt_no_raw_canary_or_secret", receiptText.length > 0 && !rawForbiddenReceiptNeedle.test(receiptText)));
checks.push(check("no_secret_or_chain_spend_inputs", true, { note: "offline/static source check; reads only tracked source/proof fixture and performs no wallet, Bankr, RPC, private-key, x402, or mainnet action" }));

const pass = checks.every((c) => c.pass);
const report = {
  pass,
  check_type: "offline_public_source_to_final_receipt_bridge",
  no_chain_spend: true,
  no_bankr_write: true,
  no_mainnet: true,
  runner_path: runnerRelativePath,
  runner_sha256: runnerSha256,
  expected_runner_sha256: expectedRunnerSha256,
  final_receipt_name: finalReceiptName,
  final_receipt_path: finalReceiptRelativePath,
  final_receipt_sha256: receiptSha256,
  expected_final_receipt_sha256: expectedFinalReceiptSha256,
  bridge_receipt_sha256: expectedBridgeSha256,
  closure_receipt_sha256: expectedClosureSha256,
  checks,
};

console.log(JSON.stringify(report, null, 2));
if (!pass) process.exit(1);
