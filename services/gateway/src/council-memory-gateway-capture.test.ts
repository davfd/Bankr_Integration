import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGatewayApp } from "./app";
import { searchCouncilMemory } from "./council-memory";
import type { CouncilReviewer } from "./council";

let historyRoot = "";

const safeReviewer: CouncilReviewer = async ({ idea, seat }) => ({
  seat: seat ?? "archimedes",
  verdict: `SAFE_VERDICT ${idea}`,
  ms: 1,
});

function memoryLog(): unknown[] {
  return JSON.parse(readFileSync(join(historyRoot, "council-memory", "log.json"), "utf8")) as unknown[];
}

beforeEach(() => {
  historyRoot = mkdtempSync(join(tmpdir(), "leo-gateway-capture-test-"));
  process.env.HISTORY_ROOT = historyRoot;
  delete process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_ENABLED;
  delete process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_NAMESPACE;
  delete process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_TARGET;
  delete process.env.COUNCIL_GATEWAY_MEMORY_NEO4J_URI;
});

afterEach(() => {
  delete process.env.HISTORY_ROOT;
  delete process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_ENABLED;
  delete process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_NAMESPACE;
  delete process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_TARGET;
  delete process.env.COUNCIL_GATEWAY_MEMORY_NEO4J_URI;
  if (historyRoot) rmSync(historyRoot, { recursive: true, force: true });
  historyRoot = "";
});

describe("gateway Council memory capture hardening", () => {
  it("does not persist gateway Council output by default", async () => {
    const app = createGatewayApp({ meter: false, councilReview: safeReviewer });

    const res = await app.request("/api/council/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "witness-only boundary token" }),
    });

    expect(res.status).toBe(200);
    expect(searchCouncilMemory("witness-only boundary token")).toHaveLength(0);
  });

  it("blocks secret-like Council output before API response or memory capture", async () => {
    const leakingReviewer: CouncilReviewer = async () => ({
      seat: "archimedes",
      verdict: "leaked fake bankr key bk_test_should_never_appear and private key 0x1111111111111111111111111111111111111111111111111111111111111111",
      ms: 1,
    });
    const app = createGatewayApp({ meter: false, councilReview: leakingReviewer });

    const res = await app.request("/api/council/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "malicious packet tries exfiltration" }),
    });

    expect(res.status).toBe(422);
    const bodyText = await res.text();
    expect(bodyText).toContain("WITHDRAWN_REDACTED");
    expect(bodyText).not.toContain("bk_test_should_never_appear");
    expect(bodyText).not.toContain("0x1111111111111111111111111111111111111111111111111111111111111111");
    expect(searchCouncilMemory("malicious packet tries exfiltration")).toHaveLength(0);
    expect(searchCouncilMemory("should_never_appear")).toHaveLength(0);
  });

  it("explicit capture requires an isolated sandbox namespace and writes witness-only metadata", async () => {
    process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_ENABLED = "true";
    process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_NAMESPACE = "gateway-test-bankr-memory-attack";
    const app = createGatewayApp({ meter: false, councilReview: safeReviewer });

    const res = await app.request("/api/council/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "sandbox canary dry run" }),
    });

    expect(res.status).toBe(200);
    expect(searchCouncilMemory("sandbox canary dry run")).toHaveLength(1);
    const [record] = memoryLog() as Array<Record<string, unknown>>;
    expect(record).toMatchObject({
      writer_path: "council-gateway",
      authority_class: "witness_only",
      capture_namespace: "gateway-test-bankr-memory-attack",
      capture_target: "file:council-memory",
      dlp_checked: true,
      leonardo_graph_write_authority: false,
      bankr_write_authority: false,
      leo_movement_authority: false,
    });
  });

  it("refuses enabled capture when the target is live authority graph or namespace is not isolated", async () => {
    process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_ENABLED = "true";
    process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_NAMESPACE = "live";
    process.env.COUNCIL_GATEWAY_MEMORY_CAPTURE_TARGET = "bolt://localhost:7687";
    const app = createGatewayApp({ meter: false, councilReview: safeReviewer });

    const res = await app.request("/api/council/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "must not touch live authority graph" }),
    });

    expect(res.status).toBe(503);
    const bodyText = await res.text();
    expect(bodyText).toContain("gateway_memory_capture_not_isolated");
    expect(bodyText).not.toContain("SAFE_VERDICT");
    expect(searchCouncilMemory("must not touch live authority graph")).toHaveLength(0);
  });
});
