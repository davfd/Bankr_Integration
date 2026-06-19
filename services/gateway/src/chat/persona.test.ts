import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composePersona, resolveSoulPath } from "./persona";

describe("persona composition", () => {
  it("loads SOUL.md as the voice and appends the platform layer", () => {
    const dir = mkdtempSync(join(tmpdir(), "leo-soul-"));
    const soul = join(dir, "SOUL.md");
    writeFileSync(soul, "I am Leonardo. Ostinato rigore. THIS_IS_THE_SOUL.", "utf8");
    try {
      const p = composePersona(soul);
      expect(p).toContain("THIS_IS_THE_SOUL"); // the real soul voice
      expect(p).toContain("Platform context"); // the operating override layer
      expect(p).toContain("council_memory"); // the full tool list
      expect(p).toContain("NO filesystem"); // standalone-agent override present
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the stub identity when SOUL.md is missing (never hard-fails)", () => {
    const p = composePersona("/nonexistent/path/SOUL.md");
    expect(p).toContain("Leonardo"); // stub identity
    expect(p).toContain("Platform context"); // still gets the operating layer + tools
    expect(p).toContain("search_graph");
  });

  it("resolves the real profile SOUL.md when Hermes profile HOME points at the profile home sandbox", () => {
    expect(resolveSoulPath(undefined, {}, "/home/exor/.hermes/profiles/leonardo/home")).toBe("/home/exor/.hermes/profiles/leonardo/SOUL.md");
  });

  it("prefers explicit LEONARDO_SOUL_PATH over profile-home inference", () => {
    expect(resolveSoulPath(undefined, { LEONARDO_SOUL_PATH: "/custom/SOUL.md" }, "/home/exor/.hermes/profiles/leonardo/home")).toBe("/custom/SOUL.md");
  });
});
