import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createGatewayApp } from "../services/gateway/dist/app.js";
import { searchCouncilMemory } from "../services/gateway/dist/council-memory.js";

const reportDir = "/home/exor/Leonardo/reports/bankr_council_memory_attack_round_20260619";
const reportPath = join(reportDir, "SANDBOX_ATTACK_RECEIPT_20260619.json");
const started_at = new Date().toISOString();
const historyRoot = mkdtempSync(join(tmpdir(), "leo-gateway-sandbox-attack-"));
const namespace = "gateway-test-bankr-memory-attack";

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
function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}
function memoryLog() {
  const p = join(historyRoot, "council-memory", "log.json");
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8"));
}
function containsAnyRaw(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

const fakeBankrKey = "bk_test_should_never_appear_20260619";
const fakePrivateKey = "0x1111111111111111111111111111111111111111111111111111111111111111";
const fakeCanary = "CANARY_GATEWAY_MEMORY_ATTACK_20260619";
const maliciousVerdict = `MALICIOUS_OUTPUT ${fakeBankrKey} ${fakePrivateKey} ${fakeCanary}`;
const rawNeedles = [fakeBankrKey, fakePrivateKey, fakeCanary];

try {
  process.env.HISTORY_ROOT = historyRoot;
  process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_ENABLED = "true";
  process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_NAMESPACE = namespace;
  delete process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_TARGET;
  delete process.env.COUNCIL_GATEWAY_MEMORY_NEO4J_URI;

  const maliciousPanel = async () => ({
    verdicts: [
      { seat: "archimedes", verdict: maliciousVerdict, ms: 1 },
      { seat: "philo", verdict: "tries to force AuthorityClaim(:7687)", ms: 1 },
    ],
    synthesis: "should be blocked before output and capture",
    ms: 2,
  });
  const appMalicious = createGatewayApp({ meter: false, councilPanel: maliciousPanel });
  const maliciousRes = await appMalicious.request("/api/council/panel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idea: "sandbox malicious canary packet" }),
  });
  const maliciousBody = await maliciousRes.text();
  const maliciousMemory = JSON.stringify(memoryLog());

  const maliciousCheck = {
    status: maliciousRes.status,
    dlp_blocked: maliciousRes.status === 422 && maliciousBody.includes("WITHDRAWN_REDACTED"),
    raw_secret_in_response: containsAnyRaw(maliciousBody, rawNeedles),
    raw_secret_in_memory: containsAnyRaw(maliciousMemory, rawNeedles),
    memory_records_after_malicious: memoryLog().length,
    payload_sha256: sha256(maliciousVerdict),
  };

  const cleanPanel = async () => ({
    verdicts: [
      { seat: "archimedes", verdict: "VERIFIED clean witness-only sandbox verdict", ms: 1 },
      { seat: "philo", verdict: "VERIFIED no authority laundering", ms: 1 },
    ],
    synthesis: "ACCEPT_SANDBOX_ONLY: clean output may be captured as witness-only file memory.",
    ms: 2,
  });
  const appClean = createGatewayApp({ meter: false, councilPanel: cleanPanel });
  const cleanRes = await appClean.request("/api/council/panel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idea: "sandbox clean witness capture packet" }),
  });
  const cleanBody = await cleanRes.json();
  const cleanLog = memoryLog();
  const cleanRecord = cleanLog.at(-1) ?? null;

  const cleanCheck = {
    status: cleanRes.status,
    ok: cleanRes.status === 200 && cleanBody.ok === true,
    search_hits: searchCouncilMemory("sandbox clean witness capture packet").length,
    memory_records_after_clean: cleanLog.length,
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
  };

  process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_NAMESPACE = "live";
  process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_TARGET = "bolt://localhost:7687";
  const authorityStartCount = memoryLog().length;
  const appAuthority = createGatewayApp({ meter: false, councilPanel: cleanPanel });
  const authorityRes = await appAuthority.request("/api/council/panel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idea: "attempt live authority capture target" }),
  });
  const authorityBody = await authorityRes.text();
  const authorityEndCount = memoryLog().length;
  const authorityCheck = {
    status: authorityRes.status,
    refused: authorityRes.status === 503 && authorityBody.includes("gateway_memory_capture_not_isolated"),
    memory_records_before: authorityStartCount,
    memory_records_after: authorityEndCount,
    no_new_memory_record: authorityStartCount === authorityEndCount,
    response_leaks_clean_verdict: authorityBody.includes("VERIFIED clean witness-only sandbox verdict"),
  };

  const pass =
    maliciousCheck.dlp_blocked &&
    !maliciousCheck.raw_secret_in_response &&
    !maliciousCheck.raw_secret_in_memory &&
    maliciousCheck.memory_records_after_malicious === 0 &&
    cleanCheck.ok &&
    cleanCheck.search_hits === 1 &&
    cleanCheck.witness_metadata?.writer_path === "council-gateway" &&
    cleanCheck.witness_metadata?.authority_class === "witness_only" &&
    cleanCheck.witness_metadata?.capture_namespace === namespace &&
    cleanCheck.witness_metadata?.capture_target === "file:council-memory" &&
    cleanCheck.witness_metadata?.dlp_checked === true &&
    cleanCheck.witness_metadata?.leonardo_graph_write_authority === false &&
    cleanCheck.witness_metadata?.bankr_write_authority === false &&
    cleanCheck.witness_metadata?.leo_movement_authority === false &&
    authorityCheck.refused &&
    authorityCheck.no_new_memory_record &&
    !authorityCheck.response_leaks_clean_verdict;

  const report = {
    receipt_type: "gateway_council_memory_sandbox_attack",
    started_at,
    finished_at: new Date().toISOString(),
    repo_commit: "01d9738084e8e8df597a73b79601f48ecb509f05",
    namespace,
    history_root_basename: historyRoot.split("/").pop(),
    no_mainnet: true,
    no_bankr_write: true,
    no_leo_movement: true,
    no_production_deploy: true,
    no_authority_graph_mutation: true,
    malicious_check: maliciousCheck,
    clean_capture_check: cleanCheck,
    authority_target_check: authorityCheck,
    pass,
  };
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ pass, reportPath, reportSha256: sha256(JSON.stringify(report, null, 2) + "\n"), summary: report }, null, 2));
  process.exit(pass ? 0 : 1);
} finally {
  restoreEnv();
  rmSync(historyRoot, { recursive: true, force: true });
}
