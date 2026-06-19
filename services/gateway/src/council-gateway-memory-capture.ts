export type CouncilGatewayMemoryMetadata = {
  writer_path: "council-gateway";
  authority_class: "witness_only";
  capture_namespace: string;
  capture_target: "file:council-memory";
  dlp_checked: true;
  leonardo_graph_write_authority: false;
  bankr_write_authority: false;
  leo_movement_authority: false;
};

export type CouncilGatewayCaptureDecision =
  | { ok: true; capture: false }
  | { ok: true; capture: true; metadata: CouncilGatewayMemoryMetadata }
  | { ok: false; status: 422 | 503; code: string; error: string; dlp_hits?: string[] };

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "bankr_api_key", pattern: /\bbk_[A-Za-z0-9_=-]{8,}\b/i },
  { name: "evm_private_key", pattern: /\b0x[a-fA-F0-9]{64}\b/ },
  { name: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}\b/i },
  { name: "x_api_key", pattern: /\bx-api-key\b\s*[:=]\s*[^\s,;]+/i },
  { name: "env_file", pattern: /(^|\s)\.env(\b|[./:=])/i },
  { name: "seed_phrase", pattern: /\b(seed phrase|mnemonic|recovery phrase)\b/i },
  { name: "synthetic_canary", pattern: /\b(CANARY_[A-Z0-9_]+|should_never_appear|caged bird opens the vault)\b/i },
];

function dlpHits(text: string): string[] {
  const hits: string[] = [];
  for (const rule of SECRET_PATTERNS) {
    if (rule.pattern.test(text)) hits.push(rule.name);
  }
  return [...new Set(hits)];
}

function isIsolatedNamespace(value: string): boolean {
  return /^gateway-(test|sandbox)-[a-z0-9][a-z0-9_-]{2,80}$/.test(value);
}

function unsafeCaptureTarget(env: NodeJS.ProcessEnv): boolean {
  const target = `${env.COUNCIL_GATEWAY_MEMORY_CAPTURE_TARGET ?? ""} ${env.COUNCIL_GATEWAY_MEMORY_NEO4J_URI ?? ""}`.toLowerCase();
  return target.includes("7687") || target.includes("authorityclaim") || target.includes("bolt://");
}

export function prepareCouncilGatewayMemoryCapture(input: {
  idea: string;
  verdicts: { seat: string; verdict: string }[];
  synthesis?: string;
}, env: NodeJS.ProcessEnv = process.env): CouncilGatewayCaptureDecision {
  const textForDlp = [input.idea, input.synthesis ?? "", ...input.verdicts.map((v) => `${v.seat}\n${v.verdict}`)].join("\n\n");
  const hits = dlpHits(textForDlp);
  if (hits.length > 0) {
    return {
      ok: false,
      status: 422,
      code: "WITHDRAWN_REDACTED",
      error: "Council output blocked by DLP before API response or memory capture",
      dlp_hits: hits,
    };
  }

  if (env.COUNCIL_GATEWAY_MEMORY_CAPTURE_ENABLED !== "true") return { ok: true, capture: false };

  const namespace = (env.COUNCIL_GATEWAY_MEMORY_CAPTURE_NAMESPACE ?? "").trim();
  const target = (env.COUNCIL_GATEWAY_MEMORY_CAPTURE_TARGET ?? "file:council-memory").trim();
  const isolatedRoot = (env.HISTORY_ROOT ?? "").trim();

  if (!isolatedRoot || !isIsolatedNamespace(namespace) || target !== "file:council-memory" || unsafeCaptureTarget(env)) {
    return {
      ok: false,
      status: 503,
      code: "gateway_memory_capture_not_isolated",
      error: "Gateway Council memory capture is enabled but not bound to an isolated file-backed sandbox namespace",
    };
  }

  return {
    ok: true,
    capture: true,
    metadata: {
      writer_path: "council-gateway",
      authority_class: "witness_only",
      capture_namespace: namespace,
      capture_target: "file:council-memory",
      dlp_checked: true,
      leonardo_graph_write_authority: false,
      bankr_write_authority: false,
      leo_movement_authority: false,
    },
  };
}
