import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BaseMcpRuntime } from "./mcp-base";
import { createBankrRuntimeFromEnv, type BankrRuntimeEnv, type BankrResponseLike } from "./bankr-adapter";

export type BankrReadinessMode = "disabled" | "read_only" | "invalid_config";

export type BankrApprovalAuthorityPreflightIssue = {
  env: string;
  check: string;
  reason: string;
};

export type BankrGovernedWritesReadiness = {
  requested: boolean;
  ready: boolean;
  reason: string;
  missing_env?: string[];
  failed_preflight?: BankrApprovalAuthorityPreflightIssue[];
};

export type BankrReceiptPublishReadiness = {
  configured: boolean;
  ready: boolean;
  reason: string;
  endpoint_path?: string;
};

export type BankrX402PaymentReadiness = {
  requested: boolean;
  configured: boolean;
  ready: boolean;
  reason: string;
  endpoint_path?: string;
};

export type BankrReadinessReceipt = {
  configured: boolean;
  mode: BankrReadinessMode;
  reason?: string;
  api_base_url?: string;
  governed_writes?: BankrGovernedWritesReadiness;
  receipt_publish?: BankrReceiptPublishReadiness;
  x402_payment?: BankrX402PaymentReadiness;
};

export type BankrReadinessResult = {
  receipt: BankrReadinessReceipt;
  runtime?: BaseMcpRuntime;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<BankrResponseLike>;

const SECRET_KEY_RE = /(api[-_ ]?key|authorization|bearer|token|session|x-leo-session|x-api-key|secret|signing[-_ ]?secret|private[-_ ]?key)/i;
const SECRET_VALUE_RE = /(leo_mcp_[A-Za-z0-9_-]+|bk_[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._~+\/-]+)/g;
const PUBLIC_RECEIPT_KEYS = new Set([
  "active_mcp_token_count",
  "acknowledged_existing_mcp_token_revocation",
  "token_create_status",
  "revoked_token",
]);

const REQUIRED_APPROVAL_AUTHORITY_ENV = [
  "BANKR_APPROVAL_STORE_PATH",
  "BANKR_APPROVAL_USAGE_STORE_PATH",
  "BANKR_APPROVAL_AUDIT_LOG_PATH",
  "BANKR_APPROVAL_SIGNING_SECRET",
] as const;

const MIN_SIGNING_SECRET_LENGTH = 32;

function probeWritableDirectory(dirPath: string, envName: string): BankrApprovalAuthorityPreflightIssue | null {
  try {
    mkdirSync(dirPath, { recursive: true });
    if (!statSync(dirPath).isDirectory()) {
      return { env: envName, check: "writable_directory", reason: "path is not a directory" };
    }
    const probePath = join(dirPath, `.bankr-approval-preflight-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
    writeFileSync(probePath, "bankr approval authority preflight\n", { encoding: "utf8", flag: "wx" });
    unlinkSync(probePath);
    return null;
  } catch {
    return { env: envName, check: "writable_directory", reason: "write probe failed" };
  }
}

function probeWritableFileParent(env: BankrRuntimeEnv, envName: string): BankrApprovalAuthorityPreflightIssue[] {
  const filePath = env[envName]?.trim();
  if (!filePath) return [];
  const issues: BankrApprovalAuthorityPreflightIssue[] = [];
  const parentIssue = probeWritableDirectory(dirname(filePath), envName);
  if (parentIssue) issues.push(parentIssue);
  if (existsSync(filePath)) {
    try {
      if (!statSync(filePath).isFile()) {
        issues.push({ env: envName, check: "readable_file", reason: "path is not a file" });
      } else {
        readFileSync(filePath, "utf8");
      }
    } catch {
      issues.push({ env: envName, check: "readable_file", reason: "read probe failed" });
    }
  }
  return issues;
}

function approvalAuthorityPreflight(env: BankrRuntimeEnv): BankrApprovalAuthorityPreflightIssue[] {
  const issues: BankrApprovalAuthorityPreflightIssue[] = [];
  const signingSecret = env.BANKR_APPROVAL_SIGNING_SECRET?.trim() ?? "";
  if (signingSecret.length < MIN_SIGNING_SECRET_LENGTH) {
    issues.push({ env: "BANKR_APPROVAL_SIGNING_SECRET", check: "min_length_32", reason: "signing secret must be at least 32 characters" });
  }

  issues.push(...probeWritableFileParent(env, "BANKR_APPROVAL_STORE_PATH"));

  const usageStorePath = env.BANKR_APPROVAL_USAGE_STORE_PATH?.trim();
  if (usageStorePath) {
    const rootIssue = probeWritableDirectory(usageStorePath, "BANKR_APPROVAL_USAGE_STORE_PATH");
    if (rootIssue) {
      issues.push(rootIssue);
    } else {
      const reservedIssue = probeWritableDirectory(join(usageStorePath, "reserved"), "BANKR_APPROVAL_USAGE_STORE_PATH");
      const consumedIssue = probeWritableDirectory(join(usageStorePath, "consumed"), "BANKR_APPROVAL_USAGE_STORE_PATH");
      if (reservedIssue) issues.push(reservedIssue);
      if (consumedIssue) issues.push(consumedIssue);
    }
  }

  issues.push(...probeWritableFileParent(env, "BANKR_APPROVAL_AUDIT_LOG_PATH"));
  return issues;
}

function sanitize(value: unknown, key = ""): unknown {
  if (SECRET_KEY_RE.test(key) && !PUBLIC_RECEIPT_KEYS.has(key)) return "[REDACTED]";
  if (typeof value === "string") {
    if (/^ftp:\/\//i.test(value)) return "[REDACTED]";
    return value.replace(SECRET_VALUE_RE, "[REDACTED]");
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey)]));
  }
  return value;
}

export function safeBankrReceiptJson(value: unknown): string {
  return JSON.stringify(sanitize(value), null, 2).replace(SECRET_VALUE_RE, "[REDACTED]");
}

function normalizeBaseUrl(value: string | undefined): string {
  const raw = (value ?? "https://api.bankr.bot").trim();
  const parsed = new URL(raw);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("invalid protocol");
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function normalizeApiPath(value: string | undefined, envName: string): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) throw new Error(`${envName} invalid`);
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  if (path.includes("..")) throw new Error(`${envName} invalid`);
  return path.replace(/\/+/g, "/");
}

function receiptPublishReadiness(endpointPath: string | undefined): BankrReceiptPublishReadiness {
  if (!endpointPath) return { configured: false, ready: false, reason: "BANKR_RECEIPT_PUBLISH_PATH is not set" };
  return { configured: true, ready: true, reason: "BANKR_RECEIPT_PUBLISH_PATH configured", endpoint_path: endpointPath };
}

function x402PaymentReadiness(env: BankrRuntimeEnv, endpointPath: string | undefined): BankrX402PaymentReadiness {
  const requested = env.BANKR_X402_PAYMENTS_ENABLED === "true";
  const configured = Boolean(endpointPath);
  if (!requested) return { requested: false, configured, ready: false, reason: "BANKR_X402_PAYMENTS_ENABLED is not true", ...(endpointPath ? { endpoint_path: endpointPath } : {}) };
  if (!endpointPath) return { requested: true, configured: false, ready: false, reason: "BANKR_X402_PAYMENT_PATH is not set" };
  return { requested: true, configured: true, ready: true, reason: "BANKR_X402 payment path configured", endpoint_path: endpointPath };
}

function governedWritesReadiness(env: BankrRuntimeEnv): BankrGovernedWritesReadiness {
  const requested = env.BANKR_GOVERNED_WRITES_ENABLED === "true";
  if (!requested) {
    return { requested: false, ready: false, reason: "BANKR_GOVERNED_WRITES_ENABLED is not true" };
  }

  const missing = REQUIRED_APPROVAL_AUTHORITY_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    return { requested: true, ready: false, reason: "Approval Authority env incomplete", missing_env: [...missing] };
  }

  const failedPreflight = approvalAuthorityPreflight(env);
  if (failedPreflight.length > 0) {
    return { requested: true, ready: false, reason: "Approval Authority preflight failed", failed_preflight: failedPreflight };
  }

  return { requested: true, ready: true, reason: "Approval Authority env complete" };
}

export function bankrReadinessFromEnv(env: BankrRuntimeEnv = process.env, fetchImpl?: FetchLike): BankrReadinessResult {
  if (!env.BANKR_API_KEY?.trim()) {
    return { receipt: { configured: false, mode: "disabled", reason: "BANKR_API_KEY missing" } };
  }

  let apiBaseUrl: string;
  try {
    apiBaseUrl = normalizeBaseUrl(env.BANKR_API_BASE_URL);
  } catch {
    return { receipt: { configured: false, mode: "invalid_config", reason: "BANKR_API_BASE_URL invalid" } };
  }

  let receiptPublishPath: string | undefined;
  let x402PaymentPath: string | undefined;
  try {
    receiptPublishPath = normalizeApiPath(env.BANKR_RECEIPT_PUBLISH_PATH, "BANKR_RECEIPT_PUBLISH_PATH");
  } catch {
    return { receipt: { configured: false, mode: "invalid_config", reason: "BANKR_RECEIPT_PUBLISH_PATH invalid" } };
  }
  try {
    x402PaymentPath = normalizeApiPath(env.BANKR_X402_PAYMENT_PATH, "BANKR_X402_PAYMENT_PATH");
  } catch {
    return { receipt: { configured: false, mode: "invalid_config", reason: "BANKR_X402_PAYMENT_PATH invalid" } };
  }

  try {
    const governedWrites = governedWritesReadiness(env);
    const receiptPublish = receiptPublishReadiness(receiptPublishPath);
    const x402Payment = x402PaymentReadiness(env, x402PaymentPath);
    const runtime = createBankrRuntimeFromEnv({
      BANKR_API_KEY: env.BANKR_API_KEY,
      BANKR_API_BASE_URL: apiBaseUrl,
      BANKR_GOVERNED_WRITES_ENABLED: governedWrites.ready ? "true" : undefined,
      BANKR_RECEIPT_PUBLISH_PATH: receiptPublishPath,
      BANKR_X402_PAYMENTS_ENABLED: x402Payment.ready ? "true" : undefined,
      BANKR_X402_PAYMENT_PATH: x402PaymentPath,
    }, fetchImpl);
    if (!runtime) return { receipt: { configured: false, mode: "disabled", reason: "BANKR_API_KEY missing", receipt_publish: receiptPublish, x402_payment: x402Payment } };
    return { runtime, receipt: { configured: true, mode: "read_only", api_base_url: apiBaseUrl, governed_writes: governedWrites, receipt_publish: receiptPublish, x402_payment: x402Payment } };
  } catch {
    return { receipt: { configured: false, mode: "invalid_config", reason: "BANKR_API_BASE_URL invalid" } };
  }
}
