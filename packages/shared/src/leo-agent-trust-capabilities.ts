export type CapabilityStatus = "live" | "beta" | "prototype" | "planned" | "blocked" | "rejected";
export type CapabilityNetwork = "base-mainnet" | "base-sepolia" | "offchain" | "none";

export type CapabilityRow = {
  id: string;
  name: string;
  status: CapabilityStatus;
  network: CapabilityNetwork;
  publicClaim: string;
  evidence: string[];
  next: string[];
  mcpScopes?: string[];
  rejectedMechanics?: string[];
};

export const LEO_TOKEN = {
  name: "Leonardo",
  symbol: "LEO",
  chain: "base-mainnet",
  chainId: 8453,
  address: "0xe1458ac40e3856b601d5dfdd1006c643a43c2ba3",
  decimals: 18,
  totalSupply: "100000000000",
  rawTotalSupply: "100000000000000000000000000000",
  launcher: "Bankr launch on Base mainnet",
  launchTx: "0x4d4e290b97b5dcd4cac5ea3eaff95df9f11b26e3785a8038d6f8c1ebbef99162",
} as const;

export const LEO_AGENT_TRUST_THESIS =
  "ERC-8004 is the address book; Leonardo is the trust engine; $LEO is the economic rail around access, receipts, bonds, bounties, and verified work.";

export const TOKEN_CAN_BUY = [
  "platform_access",
  "mcp_calls",
  "council_intake",
  "workshop_intake",
  "quest_bounties",
  "work_bonds",
  "receipts",
  "metered_compute",
] as const;

export const TOKEN_CANNOT_BUY = [
  "truth",
  "council_verdicts",
  "safety_clearance",
  "scripture_interpretation",
  "agent_authority",
  "reputation_without_verified_work",
] as const;

export const CAPABILITY_MATRIX: CapabilityRow[] = [
  {
    id: "leo_base_erc20",
    name: "$LEO ERC-20",
    status: "live",
    network: "base-mainnet",
    publicClaim: "$LEO is a live Base-mainnet ERC-20 named Leonardo, symbol LEO, with 18 decimals and 100B supply.",
    evidence: [
      `contract ${LEO_TOKEN.address}`,
      `launch tx ${LEO_TOKEN.launchTx}`,
      "Bankr launch page shows DEPLOYED on Base",
      "RPC reads returned name/symbol/decimals/totalSupply",
    ],
    next: ["Keep token facts visible in product copy", "Do not present market data as investment advice"],
  },
  {
    id: "holder_beta_access",
    name: "$LEO holder beta access",
    status: "beta",
    network: "base-mainnet",
    publicClaim: "$LEO can be used as the beta access rail, while the private deployment may still keep an allowlist/signature gate around the app.",
    evidence: ["apps/web/lib/token-gate.ts", "apps/web/app/api/auth/route.ts", "apps/web/middleware.ts"],
    next: ["Unify holder gate and allowlist language", "Add receipts for successful holder access checks"],
  },
  {
    id: "imagination_graph",
    name: "Imagination Graph search",
    status: "live",
    network: "offchain",
    publicClaim: "Leonardo can search the graph and return concepts with provenance discipline; mentions are evidence, concepts are clusters.",
    evidence: ["services/gateway/src/graph.ts", "services/workshop-sidecar/app.py /graph/*", "docs/V0.1-STATUS.md"],
    next: ["Keep graph writes out of public MCP", "Expose bounded provenance, not raw Neo4j/Cypher"],
    mcpScopes: ["graph:read"],
  },
  {
    id: "public_graph_mcp",
    name: "Imagination Graph MCP",
    status: "beta",
    network: "offchain",
    publicClaim: "Closed-beta independent MCP surface for external agents to receive scoped, revocable, read-only tokens for graph provenance and scriptural-reference tools; not the complete Agent Trust Stack and no writes, raw Cypher, imports, terminal, filesystem, or raw memory dumps.",
    evidence: ["services/gateway/src/mcp-routes.test.ts", "services/gateway/src/mcp-tokens.ts", "services/gateway/src/mcp-live-smoke.ts", "apps/web/app/tools/graph/page.tsx"],
    next: ["Maintain gateway token/session checks", "Keep public copy explicit that beta MCP is independent from the full Agent Trust Stack", "Add abuse/rate metrics per MCP token"],
    mcpScopes: ["graph:read", "scripture:read"],
  },
  {
    id: "council_memory_read",
    name: "Council Memory MCP",
    status: "beta",
    network: "offchain",
    publicClaim: "Council Memory MCP is a separate governed read surface: bounded search/summarize precedents and rulings, not raw memory dumps, mutable public memory, or verdict authority.",
    evidence: ["services/workshop-sidecar/app.py /council/search", "services/gateway/src/council-memory.ts", "services/gateway/src/mcp-graph.ts", "docs/V0.1-STATUS.md"],
    next: ["Maintain `search_council_memory` through scoped MCP", "Redact private/source-sensitive memory before public summaries"],
    mcpScopes: ["council_memory:read"],
  },
  {
    id: "council_planning_audit",
    name: "Council planning and audit intake",
    status: "planned",
    network: "offchain",
    publicClaim: "Paid or staked users may request Council planning/audit intake; payment buys queue/cost recovery, never PASS/REJECT, truth, or safety clearance.",
    evidence: ["docs/plans/2026-06-15-leo-agent-trust-platform-master-plan.md", "services/gateway/src/app.ts /api/council/*"],
    next: ["Add request_council_plan endpoint", "Add request_council_audit endpoint", "Attach receipts and Council Memory handles"],
  },
  {
    id: "workshop_intake",
    name: "Workshop intake",
    status: "prototype",
    network: "offchain",
    publicClaim: "Workshop research/build/reproduction intake is a paid/staked request surface; outputs must be bounded, receipted, and safety-scoped.",
    evidence: ["services/workshop-sidecar/app.py", "docs/plans/2026-06-15-leo-agent-trust-platform-master-plan.md"],
    next: ["Add request_workshop_brief/reproduction/build routes", "Define artifact packets, hashes, redaction, and safety dispositions"],
  },
  {
    id: "x402_metering",
    name: "x402 dollar-priced metering",
    status: "beta",
    network: "base-sepolia",
    publicClaim: "Gateway x402 metering exists today as Base-Sepolia dollar-priced pay-per-use for chat/Council paths, not as live $LEO settlement.",
    evidence: ["services/gateway/src/app.ts paymentMiddleware", "packages/contracts/src/x402pay.ts"],
    next: ["Keep public copy explicit: testnet/dollar-priced", "Reject wrong payer/chain/asset in tests"],
  },
  {
    id: "leo_x402_settlement",
    name: "$LEO x402/custom ERC-20 settlement",
    status: "planned",
    network: "base-mainnet",
    publicClaim: "$LEO settlement for machine payments is future work until custom ERC-20/Permit2/facilitator or direct allowance checkout is proven end-to-end.",
    evidence: ["current code has no $LEO token address in x402 route config", "docs/plans/2026-06-15-leo-agent-trust-platform-master-plan.md"],
    next: ["Spike custom ERC-20 x402", "Fallback to direct ERC-20 checkout if x402 custom asset is not ready"],
  },
  {
    id: "quest_board",
    name: "Quest board / verified-work rewards",
    status: "prototype",
    network: "offchain",
    publicClaim: "Quest rewards are for verified useful work; no automatic payout or reputation minting without Council/Workshop gates and receipts.",
    evidence: ["supabase/migrations/0002_quests_wallet.sql", "tokenized-protocol-design quest framing", "reports/sybil-resistance-design-v5.md"],
    next: ["Manual Safe-reviewed payout queue", "Submission receipts", "Reject wash quests and raw weaponization bounties"],
  },
  {
    id: "staking_allowances",
    name: "Non-transferable staking allowances",
    status: "planned",
    network: "base-mainnet",
    publicClaim: "Staking, if built, should grant account-bound allowances/discounts/priority or delegated org seats — not passive yield or resale of free usage.",
    evidence: ["docs/plans/2026-06-15-leo-agent-trust-platform-master-plan.md"],
    next: ["Design allowance ledger", "Add anti-rental caps and non-transferability", "Legal/economic review before launch"],
    rejectedMechanics: ["resellable_free_usage_credits", "passive_yield_story", "token_weighted_truth_or_verdicts"],
  },
  {
    id: "agent_passport",
    name: "Agent Passport / ERC-8004 identity",
    status: "beta",
    network: "base-sepolia",
    publicClaim: "Agent Passport paths read live ERC-8004 identity on Base and experiment with write/mint/reputation flows on Base Sepolia; not yet a full trust registry product.",
    evidence: ["services/gateway/src/identity.ts", "packages/contracts/src/client.ts", "packages/contracts/src/write.ts", "packages/contracts/src/reputation.ts"],
    next: ["Bind passports to receipt bundles", "Do not let tokens buy agent authority or reputation"],
  },
  {
    id: "passport_governed_base_mcp",
    name: "Passport-governed Base MCP",
    status: "prototype",
    network: "base-sepolia",
    publicClaim: "Passport-governed Base MCP is a first wrapper surface where Base actions pass through an Identity Kernel passport, capability grants, risk manifests, and receipts; it does not expose raw transfer/swap/approve/deploy tools or prove live custom $LEO settlement.",
    evidence: ["services/gateway/src/mcp-base.ts", "services/gateway/src/mcp-base.test.ts", "services/gateway/src/mcp-routes.test.ts"],
    next: ["Add smart-wallet/session-key limits below the Kernel", "Wire real Base read/x402/EAS adapters after policy-only receipts stay green", "Keep arbitrary contract execution human-gated"],
    mcpScopes: ["base_mcp:governed"],
    rejectedMechanics: ["raw_transfer_tool", "raw_swap_tool", "unlimited_approve_tool", "self_declared_capability_grants"],
  },
  {
    id: "bankr_runtime_adapter",
    name: "Bankr runtime adapter",
    status: "prototype",
    network: "offchain",
    publicClaim: "Bankr is a downstream runtime behind Passport-governed Base MCP: read path plus governed-write scaffolding, configurable hash-only receipt attestations, x402 payment adapter is explicitly env-gated and disabled by default, operator-triggered read-only live-smoke route, server-side keyed, approval-store sealed for submit, Approval Authority v1 ledgered, Council ALLOW_AFTER_FIX and Council ALLOW_AFTER_DELTA audited, readiness doctor blocks governed-write flags without Approval Authority env, preflight checks approval/usage/audit paths and signing-secret strength, read-only policy_hash runtime gate, and not live $LEO x402 settlement or direct wallet power.",
    evidence: [
      "services/gateway/src/bankr-adapter.ts",
      "services/gateway/src/bankr-approval-store.ts",
      "services/gateway/src/bankr-readiness.ts",
      "services/gateway/src/bankr-readiness.test.ts",
      "services/gateway/src/bankr-live-smoke.ts",
      "services/gateway/src/app.ts /api/bankr/live-smoke",
      "apps/web/app/status/page.tsx",
      "services/gateway/src/bankr-skill-catalog.ts",
      "docs/bankr-approval-authority-runbook.md",
      "docs/bankr-runtime-adapter.md",
      "docs/bankr-base-authority-boundary-ledger.md",
      "services/gateway/src/mcp-base.ts",
      "services/gateway/src/mcp-base.test.ts",
      "services/gateway/src/bankr-adapter.test.ts",
      "services/gateway/src/bankr-approval-store.test.ts",
      "services/gateway/src/bankr-skill-catalog.test.ts",
      "commit a9eb644 feat: add approval-backed Bankr submit wrapper",
      "commit e6ab28c test: prove Bankr submit rejects raw args before approval lookup",
      "commit 3c5c6ec feat: add Bankr approval authority ledger",
      "commit b42b4f2 fix: gate Bankr writes on approval authority readiness",
      "commit 12ded36 fix: preflight Bankr approval authority readiness",
      "commit 46683dc feat: publish Bankr receipt attestations",
      "commit 697b5d4 feat: wire Bankr x402 payments behind env gate",
      "Council audit PACKET.md sha256 626e598ecf90eedb11ea15d5eb61e9c2ef9db55fa0bd415379a42203b6e83505",
      "Council delta DELTA_RECHECK.md sha256 04ddeaf598335ad1051c0969074199c4262e1ec31c46816cef18fe2d513f148b",
      "Council delta DELTA_SOURCE_READBACK.md sha256 9266fdae4a78f7faab4b3b315b9af06d45aba2d6b3ca7052e414124864d38734",
      "/home/exor/Leonardo/public_sources/github/BankrBot__skills @ 427ad9b918ce32e00343f64f271d31c73cb00182",
    ],
    next: ["Use read-only Bankr API keys for read smoke", "Enable governed writes only with explicit server flag, approval-store records, and bounded operator authorization", "Keep configured x402 payment path disabled by default and separate from live custom-token settlement claims", "Scan SKILL.md plus references and scripts before deriving descriptive templates"],
    mcpScopes: ["base_mcp:governed"],
    rejectedMechanics: ["raw_wallet_sign", "raw_wallet_submit", "raw_transfer", "raw_swap", "bankr_agent_api_write_execution", "skill_text_as_authority"],
  },
];

export function capabilityById(id: string): CapabilityRow | undefined {
  return CAPABILITY_MATRIX.find((row) => row.id === id);
}

export function liveCapabilities(): CapabilityRow[] {
  return CAPABILITY_MATRIX.filter((row) => row.status === "live" || row.status === "beta");
}

export function plannedCapabilities(): CapabilityRow[] {
  return CAPABILITY_MATRIX.filter((row) => row.status === "planned");
}
