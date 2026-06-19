import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  capabilityGrantTemplatesFromFindings,
  classifyBankrEndpoint,
  classifyBankrMechanics,
  scanBankrSkillDirectory,
  summarizeBankrScan,
} from "./bankr-skill-catalog";

describe("Bankr skill catalog guardrails", () => {
  it("classifies observed Bankr REST endpoints without exposing raw endpoint powers", () => {
    expect(classifyBankrEndpoint("GET", "/wallet/me")).toMatchObject({
      risk: "read",
      mappedWrapper: "read_wallet_state",
      rawEndpointExposedInMcp: false,
      capabilityTemplateAllowed: true,
    });
    expect(classifyBankrEndpoint("GET", "/wallet/portfolio")).toMatchObject({
      risk: "read",
      mappedWrapper: "read_wallet_state",
      rawEndpointExposedInMcp: false,
      capabilityTemplateAllowed: true,
    });
    expect(classifyBankrEndpoint("POST", "/wallet/swap-quote")).toMatchObject({
      risk: "read_quote",
      rawEndpointExposedInMcp: false,
      capabilityTemplateAllowed: false,
    });

    for (const endpoint of ["/wallet/transfer", "/wallet/swap", "/wallet/sign", "/wallet/submit"]) {
      expect(classifyBankrEndpoint("POST", endpoint)).toMatchObject({
        risk: "write_or_dangerous",
        rawEndpointExposedInMcp: false,
        capabilityTemplateAllowed: false,
      });
    }

    expect(classifyBankrEndpoint("GET", "/agent/me")).toMatchObject({ risk: "stale_legacy", rawEndpointExposedInMcp: false });
    expect(classifyBankrEndpoint("POST", "/agent/submit")).toMatchObject({ risk: "stale_legacy", rawEndpointExposedInMcp: false });
  });

  it("detects Bankr Agent natural-language write execution as dangerous mechanics", () => {
    const findings = classifyBankrMechanics('bankr agent "Submit this transaction to the network"', "scripts/donate.sh");
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ risk: "agent_write_execution", mechanic: expect.stringContaining("bankr agent"), rawEndpointExposedInMcp: false }),
      ]),
    );
  });

  it("scans SKILL.md, references, and scripts but ignores private or irrelevant files", () => {
    const root = mkdtempSync(join(tmpdir(), "bankr-skill-scan-"));
    try {
      writeFileSync(join(root, "SKILL.md"), "Use GET /wallet/me and GET /wallet/portfolio for read-only state.");
      mkdirSync(join(root, "references"));
      writeFileSync(join(root, "references", "bankr-signer.md"), "Legacy code still says POST https://api.bankr.bot/agent/submit");
      mkdirSync(join(root, "scripts"));
      writeFileSync(join(root, "scripts", "donate.sh"), 'bankr agent "Submit this transaction"');
      mkdirSync(join(root, ".git"));
      writeFileSync(join(root, ".git", "config"), "POST /wallet/submit");
      mkdirSync(join(root, "node_modules"));
      writeFileSync(join(root, "node_modules", "pkg.js"), "POST /wallet/transfer");
      writeFileSync(join(root, ".env"), "BANKR_API_KEY=bk_should_not_be_read\nPOST /wallet/sign");

      const scan = scanBankrSkillDirectory(root);
      const scannedPaths = scan.files.map((file) => file.path).sort();
      expect(scannedPaths).toEqual(["SKILL.md", "references/bankr-signer.md", "scripts/donate.sh"]);

      const summary = summarizeBankrScan(scan);
      expect(summary.findingsByRisk).toMatchObject({ read: 2, stale_legacy: 1, agent_write_execution: 1 });
      expect(summary.safeToAutoInstall).toBe(false);
      expect(scan.findings).toEqual(expect.arrayContaining([expect.objectContaining({ file: "references/bankr-signer.md", risk: "stale_legacy" })]));
      expect(scan.findings).toEqual(expect.arrayContaining([expect.objectContaining({ file: "scripts/donate.sh", risk: "agent_write_execution" })]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not generate templates for mixed artifacts that contain dangerous or stale findings", () => {
    const findings = classifyBankrMechanics([
      "GET /wallet/me",
      "GET /wallet/portfolio",
      "POST /wallet/submit",
      "POST /agent/submit",
      'bankr agent "Submit this transaction"',
    ].join("\n"), "SKILL.md");

    expect(capabilityGrantTemplatesFromFindings(findings)).toEqual([]);
  });

  it("generates descriptive governed-wrapper templates only for clean read findings", () => {
    const findings = classifyBankrMechanics([
      "GET /wallet/me",
      "GET /wallet/portfolio",
    ].join("\n"), "SKILL.md");

    const templates = capabilityGrantTemplatesFromFindings(findings);
    expect(templates).toEqual([
      expect.objectContaining({
        capability: "base.wallet.read",
        mappedWrapper: "read_wallet_state",
        source: "bankr_skill_catalog",
        descriptiveOnly: true,
      }),
    ]);
    expect(JSON.stringify(templates)).not.toMatch(/submit|sign|transfer|swap|agent\/submit/);
  });
});
