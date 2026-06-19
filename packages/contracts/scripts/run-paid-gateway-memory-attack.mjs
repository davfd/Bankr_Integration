import { createServer } from "node:http";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createWalletClient, createPublicClient, http, erc20Abi, parseAbiItem } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { wrapFetchWithPayment } from "x402-fetch";
import { createGatewayApp } from "../../../services/gateway/dist/app.js";
import { searchCouncilMemory } from "../../../services/gateway/dist/council-memory.js";

const reportDir = "/home/exor/Leonardo/reports/bankr_council_memory_attack_round_20260619";
const reportPath = join(reportDir, "BASE_SEPOLIA_PAID_ATTACK_FINAL_RECEIPT_20260619.json");
const started_at = new Date().toISOString();
const historyRoot = mkdtempSync(join(tmpdir(), "leo-gateway-paid-x402-attack-"));
const namespace = "gateway-test-paid-x402-attack";
const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}
function memoryLog() {
  const p = join(historyRoot, "council-memory", "log.json");
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8"));
}
function decodePaymentHeader(value) {
  if (!value) return null;
  const attempts = [value, Buffer.from(value, "base64").toString("utf8")];
  for (const candidate of attempts) {
    try { return JSON.parse(candidate); } catch {}
  }
  return { unparsed_sha256: sha256(value), length: value.length };
}
function sanitizePaymentResponse(value) {
  if (!value || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value, (key, val) => {
    if (/authorization|signature|proof|token|payload/i.test(key)) return "[REDACTED]";
    return val;
  }));
}
function rawNeedleHit(text, needles) {
  return needles.some((needle) => text.includes(needle));
}
async function startServer(app) {
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) for (const v of value) headers.append(key, v);
        else if (value !== undefined) headers.set(key, value);
      }
      const request = new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers,
        body,
        duplex: body ? "half" : undefined,
      });
      const response = await app.fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}
async function usdcReceipt(client, payTo, waitTxHash = null) {
  let waited_tx_receipt = null;
  if (waitTxHash) {
    const receipt = await client.waitForTransactionReceipt({ hash: waitTxHash, timeout: 120_000 });
    waited_tx_receipt = {
      tx_hash: waitTxHash,
      status: receipt.status,
      block_number: receipt.blockNumber?.toString(),
      from: receipt.from,
      to: receipt.to,
      logs_count: receipt.logs.length,
    };
  }
  const balance = await client.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [payTo] });
  const latest = await client.getBlockNumber();
  const fromBlock = latest > 1500n ? latest - 1500n : 0n;
  let logs = [];
  let log_error = null;
  try {
    logs = await client.getLogs({
      address: usdc,
      event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
      args: { to: payTo },
      fromBlock,
      toBlock: latest,
    });
  } catch (err) {
    log_error = err?.shortMessage ?? err?.message ?? String(err);
  }
  return {
    waited_tx_receipt,
    usdc,
    balance_raw: balance.toString(),
    balance_usdc: Number(balance) / 1e6,
    latest_block: latest.toString(),
    from_block: fromBlock.toString(),
    transfer_log_count: logs.length,
    log_error,
    logs: logs.map((l) => ({
      tx_hash: l.transactionHash,
      block_number: l.blockNumber.toString(),
      value_raw: l.args.value?.toString(),
      from: l.args.from,
      to: l.args.to,
    })),
  };
}

const envKeys = [
  "HISTORY_ROOT",
  "COUNCIL_GATEWAY_MEMORY_CAPTURE_ENABLED",
  "COUNCIL_GATEWAY_MEMORY_CAPTURE_NAMESPACE",
  "COUNCIL_GATEWAY_MEMORY_CAPTURE_TARGET",
  "COUNCIL_GATEWAY_MEMORY_NEO4J_URI",
];
const oldEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
function restoreEnv() {
  for (const [k, v] of Object.entries(oldEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const privateKey = process.env.PLATFORM_TESTNET_PRIVATE_KEY;
if (!privateKey) {
  console.log(JSON.stringify({ pass: false, blocked: "missing_PLATFORM_TESTNET_PRIVATE_KEY" }, null, 2));
  process.exit(2);
}
const payer = privateKeyToAccount(privateKey);
const payTo = privateKeyToAccount(generatePrivateKey()).address;

const fakeBankrKey = "bk_test_should_never_appear_paid_x402";
const fakePrivateKey = "0x2222222222222222222222222222222222222222222222222222222222222222";
const fakeCanary = "CANARY_PAID_X402_GATEWAY_MEMORY_ATTACK_20260619";
const maliciousVerdict = `MALICIOUS_PAID_X402_OUTPUT ${fakeBankrKey} ${fakePrivateKey} ${fakeCanary}`;
const rawNeedles = [fakeBankrKey, fakePrivateKey, fakeCanary];

let server;
try {
  process.env.HISTORY_ROOT = historyRoot;
  process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_ENABLED = "true";
  process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_NAMESPACE = namespace;
  process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_TARGET = "file:council-memory";
  delete process.env.COUNCIL_GATEWAY_MEMORY_NEO4J_URI;

  const app = createGatewayApp({
    meter: true,
    payTo,
    councilReview: async ({ idea, seat }) => {
      if (idea.includes("malicious")) return { seat: seat ?? "archimedes", verdict: maliciousVerdict, ms: 1 };
      return { seat: seat ?? "archimedes", verdict: "VERIFIED clean paid x402 witness-only verdict", ms: 1 };
    },
  });
  const started = await startServer(app);
  server = started.server;

  const wallet = createWalletClient({
    account: payer,
    chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org"),
  });
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org"),
  });
  const payFetch = wrapFetchWithPayment(fetch, wallet);

  const maliciousRes = await payFetch(`${started.url}/api/council/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idea: "paid Base Sepolia malicious DLP canary packet", seat: "archimedes" }),
  });
  const maliciousBody = await maliciousRes.text();
  const maliciousMemory = JSON.stringify(memoryLog());
  const maliciousCheck = {
    response_status: maliciousRes.status,
    dlp_blocked: maliciousBody.includes("WITHDRAWN_REDACTED"),
    raw_secret_in_response: rawNeedleHit(maliciousBody, rawNeedles),
    raw_secret_in_memory: rawNeedleHit(maliciousMemory, rawNeedles),
    memory_records_after_malicious: memoryLog().length,
    payment_response_present: maliciousRes.headers.has("x-payment-response"),
    note: "x402 settlement is expected not to occur on final 422; clean paid call below proves settlement.",
  };

  const cleanRes = await payFetch(`${started.url}/api/council/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idea: "paid Base Sepolia clean witness capture packet", seat: "archimedes" }),
  });
  const cleanBodyText = await cleanRes.text();
  let cleanBody = null;
  try { cleanBody = JSON.parse(cleanBodyText); } catch {}
  const paymentHeader = cleanRes.headers.get("x-payment-response") ?? cleanRes.headers.get("X-PAYMENT-RESPONSE");
  const paymentResponse = sanitizePaymentResponse(decodePaymentHeader(paymentHeader));
  const paymentTxHash = paymentResponse && typeof paymentResponse === "object" && typeof paymentResponse.transaction === "string"
    ? paymentResponse.transaction
    : null;
  const log = memoryLog();
  const cleanRecord = log.at(-1) ?? null;
  const chain = await usdcReceipt(publicClient, payTo, paymentTxHash);
  const cleanCheck = {
    response_status: cleanRes.status,
    ok: cleanRes.status === 200 && cleanBody?.ok === true,
    raw_secret_in_response: rawNeedleHit(cleanBodyText, rawNeedles),
    search_hits: searchCouncilMemory("paid Base Sepolia clean witness capture packet").length,
    memory_records_after_clean: log.length,
    witness_metadata: cleanRecord
      ? {
          writer_path: cleanRecord.writer_path,
          authority_class: cleanRecord.authority_class,
          capture_namespace: cleanRecord.capture_namespace,
          capture_target: cleanRecord.capture_target,
          dlp_checked: cleanRecord.dlp_checked,
          leonardo_graph_write_authority: cleanRecord.leonardo_graph_write_authority,
          bankr_write_authority: cleanRecord.bankr_write_authority,
          leo_movement_authority: cleanRecord.leo_movement_authority,
        }
      : null,
    payment_response: paymentResponse,
    chain,
  };

  const pass =
    maliciousCheck.response_status === 422 &&
    maliciousCheck.dlp_blocked &&
    !maliciousCheck.raw_secret_in_response &&
    !maliciousCheck.raw_secret_in_memory &&
    maliciousCheck.memory_records_after_malicious === 0 &&
    cleanCheck.ok &&
    !cleanCheck.raw_secret_in_response &&
    cleanCheck.search_hits === 1 &&
    cleanCheck.witness_metadata?.writer_path === "council-gateway" &&
    cleanCheck.witness_metadata?.authority_class === "witness_only" &&
    cleanCheck.witness_metadata?.capture_namespace === namespace &&
    cleanCheck.witness_metadata?.capture_target === "file:council-memory" &&
    cleanCheck.witness_metadata?.dlp_checked === true &&
    cleanCheck.witness_metadata?.leonardo_graph_write_authority === false &&
    cleanCheck.witness_metadata?.bankr_write_authority === false &&
    cleanCheck.witness_metadata?.leo_movement_authority === false &&
    cleanCheck.chain.waited_tx_receipt?.status === "success" &&
    cleanCheck.chain.transfer_log_count >= 1 &&
    BigInt(cleanCheck.chain.balance_raw) >= 50000n &&
    payer.address.toLowerCase() !== payTo.toLowerCase();

  const report = {
    receipt_type: "base_sepolia_paid_gateway_memory_attack",
    started_at,
    finished_at: new Date().toISOString(),
    repo_commit: "557d4d7d5e4d4975f21afdbb89e949b9969f6e58",
    repair_commit: "01d9738084e8e8df597a73b79601f48ecb509f05",
    network: "base-sepolia",
    route: "/api/council/review",
    price: "0.05 USDC testnet x402 for settled clean call; malicious 422 is not settled by x402 middleware",
    payer: payer.address,
    payTo,
    payer_equals_payTo: payer.address.toLowerCase() === payTo.toLowerCase(),
    namespace,
    no_mainnet: true,
    no_bankr_write: true,
    no_leo_movement: true,
    no_production_deploy: true,
    no_authority_graph_mutation: true,
    malicious_payload_sha256: sha256(maliciousVerdict),
    malicious_check: maliciousCheck,
    clean_paid_capture_check: cleanCheck,
    pass,
  };
  mkdirSync(reportDir, { recursive: true });
  const reportText = JSON.stringify(report, null, 2) + "\n";
  writeFileSync(reportPath, reportText, "utf8");
  console.log(JSON.stringify({ pass, reportPath, reportSha256: sha256(reportText), summary: report }, null, 2));
  process.exit(pass ? 0 : 1);
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  restoreEnv();
  rmSync(historyRoot, { recursive: true, force: true });
}
