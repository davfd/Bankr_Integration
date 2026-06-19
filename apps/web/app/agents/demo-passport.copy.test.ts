import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const passportPath = join(process.cwd(), "apps/web/public/agents/demo-passport.json");

describe("Leonardo demo Agent Passport static document", () => {
  it("self-identifies the live Base Sepolia ERC-8004 passport fixture and carries Identity Kernel fields", () => {
    const passport = JSON.parse(readFileSync(passportPath, "utf8")) as Record<string, unknown>;

    expect(passport).toMatchObject({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      passport_id: "6960",
      agent_id: "leonardo-demo-agent",
      active_system_prompt_hash: "sha256:7cd15ae861aa3a6a011efcb219f6ddf832dcd6923624c82aca71fff7d1dde675",
      risk_context: "public_chat",
      active: true,
    });
    expect(passport.authority_scope).toEqual(expect.arrayContaining(["answer", "search", "summarize"]));
  });
});
