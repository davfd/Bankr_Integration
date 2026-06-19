import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IntegrityError } from "@leonardo/shared";
import {
  provisionAgent,
  agentStatus,
  promptAgent,
  destroyAgent,
  agentPaths,
  requestAutonomousSpend,
  liveCapabilities,
  type PromptExec,
} from "./runner";
import { createGatewayApp } from "../app";

const W1 = "0xaaaa000000000000000000000000000000000001";
const W2 = "0xbbbb000000000000000000000000000000000002";

beforeEach(() => {
  delete process.env.GATEWAY_TOKEN;
  process.env.AGENT_RUNNER_ROOT = mkdtempSync(join(tmpdir(), "agents-"));
  // Seed profile fixture (stands in for the Hermes template).
  const seed = mkdtempSync(join(tmpdir(), "seed-"));
  writeFileSync(join(seed, "config.yaml"), "model: test\n");
  writeFileSync(join(seed, "auth.json"), "{}");
  process.env.AGENT_SEED_PROFILE = seed;
});

describe("agent runner · lifecycle + isolation", () => {
  it("provisions an isolated home per wallet, seeded from the template", () => {
    const s = provisionAgent(W1);
    expect(s.provisioned).toBe(true);
    const p = agentPaths(W1);
    expect(existsSync(join(p.home, "config.yaml"))).toBe(true);
    expect(existsSync(p.workspace)).toBe(true);
  });

  it("two wallets get fully separate trees; destroying one leaves the other", () => {
    provisionAgent(W1);
    provisionAgent(W2);
    const p1 = agentPaths(W1);
    const p2 = agentPaths(W2);
    expect(p1.base).not.toBe(p2.base);
    writeFileSync(join(p1.workspace, "secret.txt"), "w1-only");
    expect(existsSync(join(p2.workspace, "secret.txt"))).toBe(false);
    destroyAgent(W2);
    expect(agentStatus(W2).provisioned).toBe(false);
    expect(agentStatus(W1).provisioned).toBe(true);
    expect(readFileSync(join(p1.workspace, "secret.txt"), "utf8")).toBe("w1-only");
  });

  it("rejects malformed wallets (no path traversal)", () => {
    expect(() => provisionAgent("../../etc")).toThrow();
    expect(() => provisionAgent("0xZZ")).toThrow();
  });

  it("prompts run in the wallet's own home + workspace and count usage", async () => {
    provisionAgent(W1);
    const seen: { home: string; workspace: string }[] = [];
    const exec: PromptExec = async ({ home, workspace }) => {
      seen.push({ home, workspace });
      return "ciao";
    };
    const out = await promptAgent(W1, "hello", exec);
    expect(out.reply).toBe("ciao");
    expect(seen[0]!.home).toBe(agentPaths(W1).home);
    expect(seen[0]!.workspace).toBe(agentPaths(W1).workspace);
    expect(agentStatus(W1).prompts).toBe(1);
  });

  it("prompting an unprovisioned agent fails", async () => {
    await expect(promptAgent(W2, "hi", async () => "x")).rejects.toThrow(/not provisioned/);
  });
});

describe("agent runner · integrity-ordering invariant (wired for real)", () => {
  it("reports the live beta capabilities with the correct canon/product mapping", () => {
    const caps = liveCapabilities();
    expect(caps).toContainEqual({
      canon: "CANON-01v2-0001",
      name: "Agent Passport / authenticated memory precedence",
      claim: "hosted_service",
    });
    expect(caps).toContainEqual({
      canon: "CANON-01v2-0006",
      name: "Local Liveness Gate",
      claim: "containment_scaffold",
    });
    expect(caps.find((c) => c.name.includes("Agent Passport"))?.canon).toBe("CANON-01v2-0001");
  });

  it("autonomous spend ALWAYS throws IntegrityError in beta (0003+0005 not live)", () => {
    provisionAgent(W1);
    expect(() => requestAutonomousSpend(W1, 1)).toThrow(IntegrityError);
    try {
      requestAutonomousSpend(W1, 1);
    } catch (e) {
      expect((e as Error).message).toContain("CANON-01v2-0003");
      expect((e as Error).message).toContain("CANON-01v2-0005");
    }
  });
});

describe("agent routes · session-gated", () => {
  const SECRET = "agent-test-secret";
  const token = (wallet: string) => {
    const exp = Date.now() + 60_000;
    const normalized = wallet.toLowerCase();
    const payload = `leo2.${normalized}.${exp}.holder`;
    const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
    return `${payload}.${sig}`;
  };

  it("provision → status → prompt → spend-blocked, all per session wallet", async () => {
    process.env.SESSION_SECRET = SECRET;
    const app = createGatewayApp({ meter: false, agentExec: async () => "salve from the hosted agent" });
    const h = { "x-leo-session": token(W1), "content-type": "application/json" };

    expect((await app.request("/api/agent/status")).status).toBe(401); // no session

    const prov = await app.request("/api/agent/provision", { method: "POST", headers: h });
    expect(prov.status).toBe(200);

    const status = (await (await app.request("/api/agent/status", { headers: h })).json()) as { provisioned: boolean };
    expect(status.provisioned).toBe(true);

    const reply = (await (
      await app.request("/api/agent/prompt", { method: "POST", headers: h, body: JSON.stringify({ prompt: "hi" }) })
    ).json()) as { ok: boolean; reply: string };
    expect(reply.ok).toBe(true);
    expect(reply.reply).toContain("salve");

    const spend = await app.request("/api/agent/spend", { method: "POST", headers: h });
    expect(spend.status).toBe(403);
    const sj = (await spend.json()) as { blocked: boolean; error: string };
    expect(sj.blocked).toBe(true);
    expect(sj.error).toContain("CANON-01v2-0003");
  });
});
