import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Council and Workshop intake copy", () => {
  it("shows Council intake receipts as queue access rather than buyable verdicts", () => {
    const page = source("apps/web/app/tools/council/page.tsx");
    expect(page).toContain("Queue Council plan intake");
    expect(page).toContain("Queue Council audit intake");
    expect(page).toContain("receipt hash");
    expect(page).toContain("Payment buys intake and queue access only");
    expect(page).toContain("does not buy verdict, truth, pass, safety clearance, Scripture interpretation, agent authority, or reputation");
  });

  it("does not derive persisted Council intake titles from the raw brief", () => {
    const page = source("apps/web/app/tools/council/page.tsx");
    expect(page).not.toContain("title: brief.slice");
    expect(page).toContain('title: kind === "plan" ? "Council plan intake" : "Council audit intake"');
  });

  it("shows Workshop intake receipts as queue access rather than promised builds", () => {
    const page = source("apps/web/app/tools/workshop/page.tsx");
    expect(page).toContain("Queue Workshop brief intake");
    expect(page).toContain("Queue reproduction intake");
    expect(page).toContain("Queue build intake");
    expect(page).toContain("receipt hash");
    expect(page).toContain("Payment buys Workshop intake and queue access only");
    expect(page).toContain("does not buy result, implementation success, safety clearance, acceptance, Scripture interpretation, agent authority, or reputation");
  });

  it("pricing copy separates live direct beta actions from governed intake receipts", () => {
    const page = source("apps/web/app/tools/pricing/page.tsx");
    expect(page).toContain("Council plan/audit intake receipt");
    expect(page).toContain("Workshop build/reproduction intake receipt");
    expect(page).toContain("payments buy queue access and receipts, not truth, verdicts, or results");
  });

  it("documents that intake receipts expose a server-keyed brief commitment, not a public unsalted brief hash", () => {
    const plan = source("docs/plans/2026-06-15-leo-agent-trust-platform-master-plan.md");
    expect(plan).toContain("server-keyed brief commitment");
    expect(plan).toContain("no public unsalted brief hash");
  });
});
