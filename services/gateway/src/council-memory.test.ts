import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordCouncil, searchCouncilMemory } from "./council-memory";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "leo-cm-"));
  process.env.HISTORY_ROOT = dir;
});
afterEach(() => {
  delete process.env.HISTORY_ROOT;
  rmSync(dir, { recursive: true, force: true });
});

describe("council memory", () => {
  it("records a panel and finds it by keyword", () => {
    recordCouncil({
      wallet: "0xabc",
      idea: "Bind agent authority to a revocable name, not its key",
      mode: "panel",
      verdicts: [{ seat: "archimedes", verdict: "mechanism is sound" }],
      synthesis: "ACCEPT — revocable naming is the right primitive.",
    });
    const hits = searchCouncilMemory("revocable name authority");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.mode).toBe("panel");
    expect(hits[0]!.ruling).toContain("ACCEPT");
    expect(hits[0]!.seats).toContain("archimedes");
  });

  it("returns nothing for an unrelated query", () => {
    recordCouncil({ idea: "memory palaces in fiction", mode: "quick", verdicts: [{ seat: "philo", verdict: "x" }] });
    expect(searchCouncilMemory("submarine propulsion")).toHaveLength(0);
  });

  it("ranks the more relevant run higher", () => {
    recordCouncil({ idea: "token vesting and clawback", mode: "panel", synthesis: "REVISE vesting schedule" });
    recordCouncil({ idea: "vesting clawback extraction caps for sybil resistance", mode: "panel", synthesis: "ACCEPT" });
    const hits = searchCouncilMemory("sybil resistance extraction caps");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.idea).toContain("sybil");
  });

  it("ignores stopword-only / too-short queries", () => {
    recordCouncil({ idea: "anything", mode: "quick" });
    expect(searchCouncilMemory("the a of")).toHaveLength(0);
  });

  it("caps the store and keeps the newest", () => {
    // Delimited slot terms so one isn't a substring of another (slot5end ⊄ slot50end).
    for (let i = 0; i < 1010; i++) recordCouncil({ idea: `idea slot${i}end`, mode: "quick" });
    expect(searchCouncilMemory("slot5end")).toHaveLength(0); // index 5 trimmed (cap 1000)
    expect(searchCouncilMemory("slot1009end")).toHaveLength(1); // newest kept
  });
});
