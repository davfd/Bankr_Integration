import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = () => readFileSync(join(process.cwd(), "apps/web/app/tools/graph/page.tsx"), "utf8");

describe("Graph tool MCP copy", () => {
  it("renders separate Imagination Graph MCP and Council Memory MCP tiles with beta token policy", () => {
    const source = page();

    expect(source).toContain("Imagination Graph MCP");
    expect(source).toContain("Council Memory MCP");
    expect(source).toContain("Imagination Graph maps invented concepts back to source evidence");
    expect(source).toContain("Council Memory searches prior Council testimony and precedent");
    expect(source).toContain("read-only graph and scriptural-reference tools");
    expect(source).toContain("bounded Council Memory precedent search");
    expect(source).toContain("Council Memory is testimony, not truth");
    expect(source).toContain("Beta tokens last 48 hours");
    expect(source).toContain("Generating a new token revokes your prior active token");
    expect(source).toContain("Closed-beta MCP access is an independent developer surface");
    expect(source).toContain("not the complete Agent Trust Stack");
    expect(source).toContain("The complete system adds Council/Workshop intake, receipts, gates, and token rails");
  });
});
