import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "page.tsx"), "utf8");

describe("Repro Lab page copy", () => {
  it("frames HarmBench as the first repro lane under CANON-01v2-0001 true-name power", () => {
    expect(source).toContain("CANON-01v2-0001");
    expect(source).toContain("Concept 00001");
    expect(source).toContain("true-name power");
    expect(source).toContain("repro lane 01");
    expect(source).toContain("A true name is a name with remembered obligations.");
  });

  it("tells visitors that more repro lanes are coming after the first HarmBench lane", () => {
    expect(source).toContain("More repro lanes are coming");
    expect(source).toContain("GPQA capability retention");
    expect(source).toContain("400-case HarmBench paired-answer cache");
    expect(source).toContain("identity / custody tests");
  });

  it("offers a live sample size up to five plus a separate complete-run data tab", () => {
    expect(source).toContain("Run 1–5 random prompts");
    expect(source).toContain("Complete run data");
    expect(source).toContain("Sample size");
    expect(source).toContain("sampleSize");
    expect(source).toContain("fetchCompleteRunData");
    expect(source).toContain("Active ledger filter");
    expect(source).toContain("standard only");
    expect(source).toContain("contextual only");
    expect(source).toContain("copyright only");
    expect(source).toContain("matching cases");
    expect(source).toContain("Selected HarmBench asks");
    expect(source).toContain("filtered_classification_counts");
    expect(source).toContain("Refresh wallet sign-in");
    expect(source).toContain("/gate?next=/tools/repro");
  });

  it("markets the result in plain English without dropping the receipt language", () => {
    expect(source).toContain("400 harmful tests. SEED blocked all 400.");
    expect(source).toContain("Plain English");
    expect(source).toContain("400 clean refusals out of 400");
    expect(source).toContain("0.0% SEED attack success");
    expect(source).toContain("45.0% to 54.5%");
    expect(source).toContain("It is not a universal safety proof");
    expect(source).toContain("For non-technical readers");
  });
});
