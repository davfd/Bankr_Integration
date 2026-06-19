import { describe, expect, it } from "vitest";
import {
  BANKR_READ_ONLY_GRANT_POLICY_SHA256,
  buildReadOnlyGrantDocument,
  grantUpdateExecutionGuard,
  summarizeGrantUpdatePlan,
  validateReadOnlyGrantDocument,
} from "./identity-kernel-passport-grant-update";

const OWNER = "0xabc0000000000000000000000000000000000001";
const OTHER = "0xdef0000000000000000000000000000000000002";
const REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

const baseDocument = {
  passport_id: "6960",
  agent_id: "leonardo-bankr-smoke",
  active_system_prompt_hash: "sha256:smoke",
  authority_scope: ["answer", "search", "summarize"],
  risk_context: "public_chat",
};

describe("read-only Passport grant update planning", () => {
  it("builds a deterministic document with exactly the Base wallet-read grant and governance witnesses", () => {
    const result = buildReadOnlyGrantDocument({
      passportId: "6960",
      currentDocument: baseDocument,
      expiresAt: "2026-06-19T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    expect(result.before_sha256).toHaveLength(64);
    expect(result.after_sha256).toHaveLength(64);
    expect(result.after_sha256).not.toBe(result.before_sha256);
    expect(result.document).toMatchObject({
      passport_id: "6960",
      capability_grants: [
        {
          capability: "base.wallet.read",
          chain_id: 8453,
          expires_at: "2026-06-19T00:00:00.000Z",
          policy_hash: BANKR_READ_ONLY_GRANT_POLICY_SHA256,
        },
      ],
    });
    expect(result.semantic_diff).toEqual({
      changed_keys: ["capability_grants"],
      changed_non_grant_keys: [],
      removed_keys: [],
      preserved_keys: ["active_system_prompt_hash", "agent_id", "authority_scope", "passport_id", "risk_context"],
      added_grant: {
        capability: "base.wallet.read",
        chain_id: 8453,
        expires_at: "2026-06-19T00:00:00.000Z",
        policy_hash: BANKR_READ_ONLY_GRANT_POLICY_SHA256,
      },
    });
    expect(validateReadOnlyGrantDocument(result.document, { now: "2026-06-18T23:00:00.000Z" })).toEqual({ ok: true, issues: [] });
  });

  it("refuses to bless broad or dangerous sibling grants", () => {
    const dangerous = {
      ...baseDocument,
      capability_grants: [
        { capability: "base.wallet.read", chain_id: 8453 },
        { capability: "base.contract.execute", chain_id: 8453, allowed_methods: ["setAgentURI"] },
      ],
    };

    expect(buildReadOnlyGrantDocument({ passportId: "6960", currentDocument: dangerous }).ok).toBe(false);
    expect(validateReadOnlyGrantDocument(dangerous).issues).toContain("unexpected_grant_count");

    const broad = { ...baseDocument, capability_grants: [{ capability: "base.wallet.read" }] };
    expect(validateReadOnlyGrantDocument(broad).issues).toContain("grant_chain_id_mismatch");
  });

  it("plans setAgentURI calldata only when the supplied signer matches ownerOf", () => {
    const good = summarizeGrantUpdatePlan({
      passportId: "6960",
      currentDocument: baseDocument,
      ownerAddress: OWNER,
      signerAddress: OWNER.toLowerCase(),
      registryAddress: REGISTRY,
      chainId: 84532,
      expiresAt: "2026-06-19T00:00:00.000Z",
    });

    expect(good.status).toBe("ready_to_sign");
    expect(good.owner_matches_signer).toBe(true);
    expect(good.transaction).toMatchObject({
      to: REGISTRY,
      chainId: 84532,
      method: "setAgentURI",
      value: "0x0",
    });
    expect(good.transaction?.data).toMatch(/^0x[0-9a-f]+$/i);
    expect(good.transaction?.args_summary).toEqual({ passport_id: "6960", uri_redacted: true });
    expect(JSON.stringify(good)).not.toContain("data:application/json");
    expect(JSON.stringify(good)).not.toContain("leonardo-bankr-smoke");

    const wrong = summarizeGrantUpdatePlan({
      passportId: "6960",
      currentDocument: baseDocument,
      ownerAddress: OWNER,
      signerAddress: OTHER,
      registryAddress: REGISTRY,
      chainId: 84532,
    });

    expect(wrong.status).toBe("blocked_signer_not_owner");
    expect(wrong.transaction).toBeUndefined();
  });

  it("reports missing signer as a fixable operator blocker without leaking the planned URI", () => {
    const summary = summarizeGrantUpdatePlan({
      passportId: "6960",
      currentDocument: baseDocument,
      ownerAddress: OWNER,
      registryAddress: REGISTRY,
      chainId: 84532,
    });

    expect(summary.status).toBe("blocked_missing_signer");
    expect(summary.required_env).toContain("PASSPORT_GRANT_UPDATE_SIGNER_PRIVATE_KEY");
    expect(summary.owner_redacted).toBe(true);
    expect(summary.planned_document).toMatchObject({ grant_count: 1, validation_ok: true });
    expect(JSON.stringify(summary)).not.toContain(OWNER);
    expect(JSON.stringify(summary)).not.toContain("data:application/json");
  });

  it("requires ready-to-sign status plus explicit acknowledgement before metadata mutation", () => {
    expect(grantUpdateExecutionGuard({ planStatus: "blocked_missing_signer", executeRequested: true, acknowledgedMetadataMutation: true })).toEqual({
      ok: false,
      status: "blocked_plan_not_ready",
    });
    expect(grantUpdateExecutionGuard({ planStatus: "ready_to_sign", executeRequested: false, acknowledgedMetadataMutation: true })).toEqual({
      ok: false,
      status: "blocked_execute_not_requested",
    });
    expect(grantUpdateExecutionGuard({ planStatus: "ready_to_sign", executeRequested: true, acknowledgedMetadataMutation: false })).toEqual({
      ok: false,
      status: "blocked_missing_metadata_mutation_ack",
    });
    expect(grantUpdateExecutionGuard({ planStatus: "ready_to_sign", executeRequested: true, acknowledgedMetadataMutation: true })).toEqual({
      ok: true,
      status: "execution_allowed",
    });
  });
});
