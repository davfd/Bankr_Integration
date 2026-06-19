import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_MATRIX,
  LEO_AGENT_TRUST_THESIS,
  LEO_TOKEN,
  TOKEN_CAN_BUY,
  TOKEN_CANNOT_BUY,
  capabilityById,
  liveCapabilities,
  plannedCapabilities,
} from "./leo-agent-trust-capabilities";

const repoDoc = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("$LEO + Agent Trust Stack capability matrix", () => {
  it("freezes the verified $LEO token facts on Base mainnet", () => {
    expect(LEO_TOKEN).toMatchObject({
      name: "Leonardo",
      symbol: "LEO",
      chain: "base-mainnet",
      chainId: 8453,
      address: "0xe1458ac40e3856b601d5dfdd1006c643a43c2ba3",
      decimals: 18,
      totalSupply: "100000000000",
    });
    expect(LEO_TOKEN.launcher).toContain("Bankr");
  });

  it("states the doctrine: the token funds access and verified work, not truth", () => {
    expect(LEO_AGENT_TRUST_THESIS).toContain("economic rail");
    expect(TOKEN_CAN_BUY).toEqual(expect.arrayContaining(["platform_access", "quest_bounties", "work_bonds", "receipts"]));
    expect(TOKEN_CANNOT_BUY).toEqual(
      expect.arrayContaining([
        "truth",
        "council_verdicts",
        "safety_clearance",
        "scripture_interpretation",
        "agent_authority",
        "reputation_without_verified_work",
      ]),
    );
  });

  it("has an evidence-backed row for every first-class platform surface", () => {
    const ids = CAPABILITY_MATRIX.map((row) => row.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "leo_base_erc20",
        "holder_beta_access",
        "imagination_graph",
        "public_graph_mcp",
        "council_memory_read",
        "council_planning_audit",
        "workshop_intake",
        "x402_metering",
        "leo_x402_settlement",
        "quest_board",
        "staking_allowances",
        "agent_passport",
        "passport_governed_base_mcp",
        "bankr_runtime_adapter",
      ]),
    );

    for (const row of CAPABILITY_MATRIX) {
      expect(row.publicClaim.length).toBeGreaterThan(10);
      expect(row.evidence.length).toBeGreaterThan(0);
      expect(row.next.length).toBeGreaterThan(0);
      expect(["live", "beta", "prototype", "planned", "blocked", "rejected"]).toContain(row.status);
    }
  });

  it("describes Passport-governed Base MCP as a governed wrapper surface, not raw wallet power", () => {
    const row = capabilityById("passport_governed_base_mcp");
    expect(row).toMatchObject({
      name: "Passport-governed Base MCP",
      status: "prototype",
      network: "base-sepolia",
      mcpScopes: ["base_mcp:governed"],
    });
    expect(row!.publicClaim).toContain("Passport-governed");
    expect(row!.publicClaim).toContain("does not expose raw transfer/swap/approve/deploy");
    expect(row!.next.join(" ")).toContain("session-key");
  });

  it("describes Bankr as a downstream governed runtime adapter, not direct wallet power", () => {
    const row = capabilityById("bankr_runtime_adapter");
    expect(row).toMatchObject({
      name: "Bankr runtime adapter",
      status: "prototype",
      network: "offchain",
      mcpScopes: ["base_mcp:governed"],
    });
    expect(row!.publicClaim).toContain("downstream runtime behind Passport-governed Base MCP");
    expect(row!.publicClaim).toContain("governed-write scaffolding");
    expect(row!.publicClaim).toContain("approval-store sealed");
    expect(row!.publicClaim).toContain("Council ALLOW_AFTER_FIX");
    expect(row!.publicClaim).toContain("Approval Authority v1");
    expect(row!.publicClaim).toContain("Council ALLOW_AFTER_DELTA");
    expect(row!.publicClaim).toContain("readiness doctor blocks governed-write flags without Approval Authority env");
    expect(row!.publicClaim).toContain("preflight checks approval/usage/audit paths and signing-secret strength");
    expect(row!.publicClaim).toContain("read-only policy_hash runtime gate");
    expect(row!.publicClaim).toContain("configurable hash-only receipt attestations");
    expect(row!.publicClaim).toContain("x402 payment adapter is explicitly env-gated and disabled by default");
    expect(row!.publicClaim).toContain("operator-triggered read-only live-smoke route");
    expect(row!.publicClaim).toContain("not live $LEO x402 settlement");
    expect(row!.evidence).toEqual(expect.arrayContaining(["services/gateway/src/bankr-adapter.ts", "services/gateway/src/bankr-approval-store.ts", "services/gateway/src/bankr-readiness.ts", "services/gateway/src/bankr-readiness.test.ts", "services/gateway/src/bankr-live-smoke.ts", "services/gateway/src/app.ts /api/bankr/live-smoke", "apps/web/app/status/page.tsx", "services/gateway/src/bankr-skill-catalog.ts", "docs/bankr-approval-authority-runbook.md", "docs/bankr-runtime-adapter.md"]));
    expect(row!.evidence.join(" ")).toContain("a9eb644");
    expect(row!.evidence.join(" ")).toContain("e6ab28c");
    expect(row!.evidence.join(" ")).toContain("3c5c6ec");
    expect(row!.evidence.join(" ")).toContain("b42b4f2");
    expect(row!.evidence.join(" ")).toContain("12ded36");
    expect(row!.evidence.join(" ")).toContain("46683dc");
    expect(row!.evidence.join(" ")).toContain("697b5d4");
    expect(row!.evidence.join(" ")).toContain("DELTA_RECHECK.md sha256 04ddeaf598335ad1051c0969074199c4262e1ec31c46816cef18fe2d513f148b");
    expect(row!.evidence.join(" ")).toContain("DELTA_SOURCE_READBACK.md sha256 9266fdae4a78f7faab4b3b315b9af06d45aba2d6b3ca7052e414124864d38734");
    expect(row!.rejectedMechanics).toEqual(expect.arrayContaining(["raw_wallet_sign", "raw_wallet_submit", "raw_transfer", "raw_swap", "bankr_agent_api_write_execution"]));
  });

  it("keeps live/beta, planned, and rejected mechanics separated", () => {
    expect(liveCapabilities().map((row) => row.id)).toEqual(
      expect.arrayContaining(["leo_base_erc20", "imagination_graph", "council_memory_read"]),
    );
    expect(plannedCapabilities().map((row) => row.id)).toEqual(
      expect.arrayContaining(["leo_x402_settlement", "staking_allowances"]),
    );

    expect(capabilityById("x402_metering")).toMatchObject({
      status: "beta",
      network: "base-sepolia",
    });
    expect(capabilityById("leo_x402_settlement")).toMatchObject({
      status: "planned",
      network: "base-mainnet",
    });
    expect(capabilityById("staking_allowances")!.rejectedMechanics).toContain("resellable_free_usage_credits");
  });

  it("keeps the public Graph MCP and Council Memory MCP capability rows split by scope", () => {
    expect(capabilityById("public_graph_mcp")).toMatchObject({
      name: "Imagination Graph MCP",
      mcpScopes: ["graph:read", "scripture:read"],
    });
    expect(capabilityById("public_graph_mcp")!.publicClaim).not.toContain("Council Memory tools");
    expect(capabilityById("council_memory_read")).toMatchObject({
      name: "Council Memory MCP",
      mcpScopes: ["council_memory:read"],
    });
    expect(capabilityById("council_memory_read")!.next.join(" ")).not.toContain("Expose search_council_memory");
  });

  it("keeps public MCP docs honest about split Graph and Council Memory token access", () => {
    const doc = repoDoc("docs/imagination-graph-mcp.md");
    expect(doc).toContain("**Imagination Graph MCP** grants `graph:read` and `scripture:read`");
    expect(doc).toContain("**Council Memory MCP** grants `council_memory:read`");
    expect(doc).toContain("`search_council_memory(query, limit?)`");
    expect(doc).toContain("Council Memory is testimony/precedent, not truth");
    expect(doc).not.toContain("Default `/tools/graph` tokens grant `graph:read`, `scripture:read`, and `council_memory:read`");
    expect(doc).not.toContain("- Council memory");
    expect(doc).not.toContain("Council memory is not exposed");
  });

  it("keeps the markdown capability matrix from describing shipped Council Memory MCP as future work", () => {
    const doc = repoDoc("docs/leo-agent-trust-capability-matrix.md");
    expect(doc).toContain("| Imagination Graph MCP | beta | offchain |");
    expect(doc).toContain("| Council Memory MCP | beta | offchain |");
    expect(doc).toContain("bounded `search_council_memory` precedent/testimony search only");
    expect(doc).not.toContain("Expose `search_council_memory`");
    expect(doc).not.toContain("graph, scriptural-reference, and bounded Council Memory tools");
  });

  it("keeps the markdown capability matrix synced to the Council-accepted Bankr governed-submit boundary", () => {
    const doc = repoDoc("docs/leo-agent-trust-capability-matrix.md");
    expect(doc).toContain("Bankr runtime adapter");
    expect(doc).toContain("approval-store sealed governed submit wrapper");
    expect(doc).toContain("Council `ALLOW_AFTER_FIX`");
    expect(doc).toContain("`a9eb644`");
    expect(doc).toContain("`e6ab28c`");
    expect(doc).toContain("`DELTA_RECHECK.md` sha256 `04ddeaf598335ad1051c0969074199c4262e1ec31c46816cef18fe2d513f148b`");
    expect(doc).toContain("Approval Authority v1");
    expect(doc).toContain("Council `ALLOW_AFTER_DELTA`");
    expect(doc).toContain("readiness doctor blocks governed-write flags without Approval Authority env");
    expect(doc).toContain("preflight checks approval/usage/audit paths and signing-secret strength");
    expect(doc).toContain("read-only `policy_hash` runtime gate");
    expect(doc).toContain("configurable hash-only receipt attestations");
    expect(doc).toContain("x402 payment adapter is explicitly env-gated and disabled by default");
    expect(doc).toContain("`46683dc`");
    expect(doc).toContain("`697b5d4`");
    expect(doc).toContain("`docs/bankr-runtime-adapter.md`");
    expect(doc).toContain("`docs/bankr-base-authority-boundary-ledger.md`");
    expect(doc).toContain("`3c5c6ec`");
    expect(doc).toContain("`b42b4f2`");
    expect(doc).toContain("`12ded36`");
    expect(doc).toContain("`DELTA_SOURCE_READBACK.md` sha256 `9266fdae4a78f7faab4b3b315b9af06d45aba2d6b3ca7052e414124864d38734`");
    expect(doc).not.toContain("Bankr is a downstream runtime behind Passport-governed Base MCP: read-only first");
  });

  it("keeps the Bankr approval authority operator runbook fail-closed", () => {
    const doc = repoDoc("docs/bankr-approval-authority-runbook.md");
    expect(doc).toContain("# Bankr Approval Authority Operator Runbook");
    expect(doc).toContain("BANKR_GOVERNED_WRITES_ENABLED=true is only a request");
    expect(doc).toContain("Do not enable production Bankr writes from this runbook");
    expect(doc).toContain("pnpm bankr:smoke:preflight");
    expect(doc).toContain("Approval Authority preflight failed");
    expect(doc).toContain("failed_preflight");
    expect(doc).toContain("BANKR_APPROVAL_STORE_PATH");
    expect(doc).toContain("BANKR_APPROVAL_USAGE_STORE_PATH");
    expect(doc).toContain("BANKR_APPROVAL_AUDIT_LOG_PATH");
    expect(doc).toContain("BANKR_APPROVAL_SIGNING_SECRET");
    expect(doc).toContain("approval/usage/audit paths and signing-secret strength");
    expect(doc).toContain("Council preflight packet before any production activation");
    expect(doc).not.toMatch(/bk_[A-Za-z0-9_-]+/);
    expect(doc).not.toMatch(/leo_mcp_[A-Za-z0-9_-]+/);
    expect(doc).not.toMatch(/Bearer\s+[A-Za-z0-9._~+\/-]+/);
  });

  it("keeps the Bankr runtime adapter doc synced to governed-write preflight receipts", () => {
    const doc = repoDoc("docs/bankr-runtime-adapter.md");
    expect(doc).toContain("`governed_writes` readiness summary");
    expect(doc).toContain("`blocked_missing_config` with `governed_writes.ready=true`");
    expect(doc).toContain("live smoke endpoint/wallet/passport/session config is still absent");
    expect(doc).toContain("does not authorize live writes");
    expect(doc).toContain("`execute_approved_value_movement` can map to Bankr `POST /wallet/transfer`, but only by `approval_id`");
    expect(doc).toContain("`execute_approved_asset_exchange` can map to Bankr `POST /wallet/swap`, but only by `approval_id`");
    expect(doc).toContain("per-action sealed Approval Authority record with `approval_hash`, `nonce`, human approval receipt, usage reservation, consume-on-accepted, and release-on-failure lifecycle");
    expect(doc).toContain("Raw transfer/swap/transaction bodies from model arguments are refused before Bankr");
    expect(doc).toContain("preflight receipt exposes `receipt_publish` and `x402_payment` readiness");
    expect(doc).toContain("operator-triggered read-only live smoke route");
    expect(doc).toContain("`POST /api/bankr/live-smoke`");
    expect(doc).toContain("`BANKR_LIVE_SMOKE_ROUTE_ENABLED=true`");
    expect(doc).toContain("`read_wallet_state`");
    expect(doc).toContain("`active_mcp_token_count`");
    expect(doc).toContain("`BANKR_RECEIPT_PUBLISH_PATH`");
    expect(doc).toContain("`BANKR_X402_PAYMENTS_ENABLED`");
    expect(doc).toContain("`BANKR_X402_PAYMENT_PATH`");
    expect(doc).not.toMatch(/bk_[A-Za-z0-9_-]+/);
    expect(doc).not.toMatch(/leo_mcp_[A-Za-z0-9_-]+/);
    expect(doc).not.toMatch(/Bearer\s+[A-Za-z0-9._~+\/-]+/);
  });

  it("keeps closed-beta MCP access independent from the complete Agent Trust Stack claim", () => {
    expect(capabilityById("public_graph_mcp")!.publicClaim).toContain("Closed-beta independent MCP surface");
    expect(capabilityById("public_graph_mcp")!.publicClaim).toContain("not the complete Agent Trust Stack");

    const mcpDoc = repoDoc("docs/imagination-graph-mcp.md");
    expect(mcpDoc).toContain("closed-beta MCP surface is independent of the complete Agent Trust Stack");
    expect(mcpDoc).toContain("It is a read-only developer surface, not the whole governed system");

    const matrixDoc = repoDoc("docs/leo-agent-trust-capability-matrix.md");
    expect(matrixDoc).toContain("Closed-beta MCP access is an independent developer surface");
    expect(matrixDoc).toContain("The complete Agent Trust Stack adds Council/Workshop intake, receipts, gates, and token rails");
  });
});
