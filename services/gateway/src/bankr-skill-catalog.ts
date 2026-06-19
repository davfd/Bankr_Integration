import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type BankrFindingRisk = "read" | "read_quote" | "write_or_dangerous" | "stale_legacy" | "agent_write_execution" | "unknown";

export type BankrFinding = {
  file?: string;
  method?: string;
  endpoint?: string;
  mechanic: string;
  risk: BankrFindingRisk;
  mappedWrapper?: "read_wallet_state" | "pay_x402_invoice" | "publish_receipt_hash" | "request_human_approved_contract_call";
  rawEndpointExposedInMcp: false;
  capabilityTemplateAllowed: boolean;
  reason: string;
};

export type BankrSkillFile = {
  path: string;
  bytes: number;
};

export type BankrSkillScan = {
  root: string;
  files: BankrSkillFile[];
  findings: BankrFinding[];
};

export type BankrSkillSummary = {
  filesScanned: number;
  findingsByRisk: Partial<Record<BankrFindingRisk, number>>;
  dangerousFindings: number;
  staleFindings: number;
  safeReadFindings: number;
  safeToAutoInstall: boolean;
};

export type BankrCapabilityGrantTemplate = {
  capability: "base.wallet.read";
  mappedWrapper: "read_wallet_state";
  source: "bankr_skill_catalog";
  descriptiveOnly: true;
  notes: string[];
};

const RAW_ENDPOINT_EXPOSED = false as const;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "coverage"]);
const MAX_SCAN_BYTES = 256_000;

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/^https?:\/\/api\.bankr\.bot/i, "");
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return path.split(/[?#]/, 1)[0]!.toLowerCase();
}

export function classifyBankrEndpoint(method: string, endpoint: string, file?: string): BankrFinding {
  const m = method.trim().toUpperCase();
  const path = normalizeEndpoint(endpoint);
  const mechanic = `${m} ${path}`;

  if ((m === "GET" && path === "/wallet/me") || (m === "GET" && path === "/wallet/portfolio")) {
    return {
      file,
      method: m,
      endpoint: path,
      mechanic,
      risk: "read",
      mappedWrapper: "read_wallet_state",
      rawEndpointExposedInMcp: RAW_ENDPOINT_EXPOSED,
      capabilityTemplateAllowed: true,
      reason: "Bankr read-only wallet endpoint; may map to governed read_wallet_state wrapper only.",
    };
  }

  if (m === "POST" && path === "/wallet/swap-quote") {
    return {
      file,
      method: m,
      endpoint: path,
      mechanic,
      risk: "read_quote",
      rawEndpointExposedInMcp: RAW_ENDPOINT_EXPOSED,
      capabilityTemplateAllowed: false,
      reason: "Bankr quote endpoint is read-like but has no v1 governed MCP wrapper.",
    };
  }

  if (m === "POST" && ["/wallet/transfer", "/wallet/swap", "/wallet/sign", "/wallet/submit"].includes(path)) {
    return {
      file,
      method: m,
      endpoint: path,
      mechanic,
      risk: "write_or_dangerous",
      rawEndpointExposedInMcp: RAW_ENDPOINT_EXPOSED,
      capabilityTemplateAllowed: false,
      reason: "Raw Bankr wallet write/sign/submit/swap power must remain hidden behind governed wrappers and human approval.",
    };
  }

  if (path.startsWith("/agent/")) {
    return {
      file,
      method: m,
      endpoint: path,
      mechanic,
      risk: "stale_legacy",
      rawEndpointExposedInMcp: RAW_ENDPOINT_EXPOSED,
      capabilityTemplateAllowed: false,
      reason: "Legacy Bankr /agent/* endpoint reference; do not use as authority or runtime path.",
    };
  }

  return {
    file,
    method: m,
    endpoint: path,
    mechanic,
    risk: "unknown",
    rawEndpointExposedInMcp: RAW_ENDPOINT_EXPOSED,
    capabilityTemplateAllowed: false,
    reason: "Unknown Bankr endpoint; fail closed until explicitly classified.",
  };
}

export function classifyBankrMechanics(text: string, file?: string): BankrFinding[] {
  const findings: BankrFinding[] = [];
  const endpointRe = /\b(GET|POST|PUT|PATCH|DELETE)\s+(?:["'`])?(https?:\/\/api\.bankr\.bot)?(\/(?:wallet|agent)\/[A-Za-z0-9_\/-]+)(?=[\s"'`?]|$)/gi;
  for (const match of text.matchAll(endpointRe)) {
    const method = match[1];
    const host = match[2] ?? "";
    const path = match[3];
    if (method && path) findings.push(classifyBankrEndpoint(method, `${host}${path}`, file));
  }

  const bankrAgentRe = /\bbankr\s+agent\b[^\n]*(submit|transaction|transfer|swap|sign|approve|deploy|write)/gi;
  for (const match of text.matchAll(bankrAgentRe)) {
    findings.push({
      file,
      mechanic: match[0].trim(),
      risk: "agent_write_execution",
      rawEndpointExposedInMcp: RAW_ENDPOINT_EXPOSED,
      capabilityTemplateAllowed: false,
      reason: "Bankr Agent natural-language write execution is not model-visible authority in Leonardo.",
    });
  }

  return findings;
}

function relPath(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join("/");
}

function isAllowedArtifactPath(path: string): boolean {
  return path === "SKILL.md" || path.startsWith("references/") || path.startsWith("scripts/");
}

function shouldSkipFile(path: string, bytes: number): boolean {
  const lower = path.toLowerCase();
  return bytes > MAX_SCAN_BYTES || lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".gif") || lower.endsWith(".webp") || lower.endsWith(".pdf") || lower.includes(".env");
}

export function scanBankrSkillDirectory(root: string): BankrSkillScan {
  const files: BankrSkillFile[] = [];
  const findings: BankrFinding[] = [];

  function walk(absDir: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(absDir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const abs = join(absDir, entry.name);
      const rel = relPath(root, abs);
      if (!isAllowedArtifactPath(rel)) continue;
      const size = statSync(abs).size;
      if (shouldSkipFile(rel, size)) continue;
      const content = readFileSync(abs, "utf8");
      if (content.includes("\u0000")) continue;
      files.push({ path: rel, bytes: size });
      findings.push(...classifyBankrMechanics(content, rel));
    }
  }

  walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  findings.sort((a, b) => `${a.file ?? ""}:${a.mechanic}`.localeCompare(`${b.file ?? ""}:${b.mechanic}`));
  return { root, files, findings };
}

export function summarizeBankrScan(scan: BankrSkillScan): BankrSkillSummary {
  const findingsByRisk: Partial<Record<BankrFindingRisk, number>> = {};
  for (const finding of scan.findings) findingsByRisk[finding.risk] = (findingsByRisk[finding.risk] ?? 0) + 1;
  const dangerousFindings = (findingsByRisk.write_or_dangerous ?? 0) + (findingsByRisk.agent_write_execution ?? 0) + (findingsByRisk.unknown ?? 0);
  const staleFindings = findingsByRisk.stale_legacy ?? 0;
  const safeReadFindings = findingsByRisk.read ?? 0;
  return {
    filesScanned: scan.files.length,
    findingsByRisk,
    dangerousFindings,
    staleFindings,
    safeReadFindings,
    safeToAutoInstall: dangerousFindings === 0 && staleFindings === 0,
  };
}

export function capabilityGrantTemplatesFromFindings(findings: BankrFinding[]): BankrCapabilityGrantTemplate[] {
  const hasBlockingFinding = findings.some((finding) =>
    finding.risk === "write_or_dangerous" ||
    finding.risk === "stale_legacy" ||
    finding.risk === "agent_write_execution" ||
    finding.risk === "unknown",
  );
  if (hasBlockingFinding) return [];

  const hasRead = findings.some((finding) => finding.risk === "read" && finding.mappedWrapper === "read_wallet_state" && finding.capabilityTemplateAllowed);
  if (!hasRead) return [];
  return [
    {
      capability: "base.wallet.read",
      mappedWrapper: "read_wallet_state",
      source: "bankr_skill_catalog",
      descriptiveOnly: true,
      notes: [
        "Template is descriptive evidence only; it cannot create or widen passport capability grants.",
        "Template is emitted only for a clean Bankr artifact scan with no dangerous, stale, agent-write, or unknown findings.",
        "Raw Bankr endpoints remain hidden behind Passport-Governed Base MCP wrappers.",
      ],
    },
  ];
}
