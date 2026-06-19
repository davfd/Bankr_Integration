import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMcpToken,
  listMcpTokens,
  revokeMcpToken,
  rotateMcpToken,
  verifyMcpToken,
  _resetMcpTokens,
} from "./mcp-tokens";

let dir: string;
let store: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "leo-mcp-tokens-"));
  store = join(dir, "tokens.json");
  process.env.MCP_TOKEN_STORE = store;
  process.env.MCP_TOKEN_SECRET = "test-mcp-token-secret";
  _resetMcpTokens();
});

afterEach(() => {
  vi.useRealTimers();
  _resetMcpTokens();
  delete process.env.MCP_TOKEN_STORE;
  delete process.env.MCP_TOKEN_SECRET;
  delete process.env.SESSION_SECRET;
  rmSync(dir, { recursive: true, force: true });
});

describe("MCP developer tokens", () => {
  it("refuses to create MCP tokens without a distinct MCP token secret", () => {
    delete process.env.MCP_TOKEN_SECRET;
    process.env.SESSION_SECRET = "session-only-is-not-enough";
    expect(() => createMcpToken({ wallet: "0xabc", label: "agent", scopes: ["graph:read"], expiresInDays: 30 })).toThrow(/MCP_TOKEN_SECRET/);
  });

  it("defaults beta MCP tokens to 48 hours when no expiry is supplied", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T00:00:00.000Z"));

    const created = createMcpToken({ wallet: "0xabc", label: "beta agent", scopes: ["graph:read"] });

    expect(created.record.expiresAt).toBe("2026-06-18T00:00:00.000Z");
  });

  it("keeps only one active MCP token per wallet by revoking older active tokens on create", () => {
    const first = createMcpToken({ wallet: "0xabc", label: "first", scopes: ["graph:read"] });
    const otherWallet = createMcpToken({ wallet: "0xdef", label: "other", scopes: ["graph:read"] });
    const second = createMcpToken({ wallet: "0xABC", label: "second", scopes: ["graph:read", "council_memory:read"] });

    expect(verifyMcpToken(first.token, "graph:read")).toMatchObject({ ok: false, code: "revoked" });
    expect(verifyMcpToken(second.token, "graph:read").ok).toBe(true);
    expect(verifyMcpToken(otherWallet.token, "graph:read").ok).toBe(true);
    expect(listMcpTokens("0xabc").filter((t) => !t.revokedAt)).toHaveLength(1);
    expect(listMcpTokens("0xabc").find((t) => t.id === first.record.id)?.revokedAt).toBeTruthy();
  });

  it("creates a show-once token, stores only a hash, and verifies by scope", () => {
    const created = createMcpToken({
      wallet: "0xABCDEF0000000000000000000000000000000001",
      label: "Workbench agent",
      scopes: ["graph:read"],
      expiresInDays: 30,
    });

    expect(created.token).toMatch(/^leo_mcp_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/);
    const rawStore = readFileSync(store, "utf8");
    expect(rawStore).not.toContain(created.token);
    expect(rawStore).toContain("tokenHash");

    const listed = listMcpTokens("0xabcdef0000000000000000000000000000000001");
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(created.token);
    expect(listed[0]).toMatchObject({ id: created.record.id, label: "Workbench agent", scopes: ["graph:read"] });

    const verified = verifyMcpToken(created.token, "graph:read", "search_graph");
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.record.wallet).toBe("0xabcdef0000000000000000000000000000000001");
      expect(verified.record.lastUsedTool).toBe("search_graph");
      expect(verified.record.lastUsedAt).toBeTruthy();
    }
  });

  it("rejects malformed, missing-scope, expired, and revoked tokens", () => {
    const created = createMcpToken({ wallet: "0xabc", label: "agent", scopes: ["graph:read"], expiresInDays: 30 });
    expect(verifyMcpToken("leo_mcp_bad", "graph:read").ok).toBe(false);
    expect(verifyMcpToken(created.token, "council:read")).toMatchObject({ ok: false, code: "insufficient_scope" });

    const expired = createMcpToken({ wallet: "0xabc", label: "old", scopes: ["graph:read"], expiresInDays: -1 });
    expect(verifyMcpToken(expired.token, "graph:read")).toMatchObject({ ok: false, code: "expired" });

    expect(revokeMcpToken("0xabc", created.record.id)).toBe(true);
    expect(verifyMcpToken(created.token, "graph:read")).toMatchObject({ ok: false, code: "revoked" });
  });

  it("supports a separate Council Memory read scope without granting graph or scripture scope", () => {
    const created = createMcpToken({
      wallet: "0xabc",
      label: "council memory agent",
      scopes: ["council_memory:read"],
      expiresInDays: 30,
    });

    expect(created.record.scopes).toEqual(["council_memory:read"]);
    expect(verifyMcpToken(created.token, "council_memory:read", "search_council_memory").ok).toBe(true);
    expect(verifyMcpToken(created.token, "graph:read", "search_graph")).toMatchObject({ ok: false, code: "insufficient_scope" });
    expect(verifyMcpToken(created.token, "scripture:read", "scripture_reference")).toMatchObject({ ok: false, code: "insufficient_scope" });
  });

  it("supports a separate governed Base MCP scope without granting raw Base powers", () => {
    const created = createMcpToken({
      wallet: "0xabc",
      label: "base agent",
      scopes: ["base_mcp:governed"],
      expiresInDays: 30,
    });

    expect(created.record.scopes).toEqual(["base_mcp:governed"]);
    expect(verifyMcpToken(created.token, "base_mcp:governed", "read_wallet_state").ok).toBe(true);
    expect(verifyMcpToken(created.token, "graph:read", "search_graph")).toMatchObject({ ok: false, code: "insufficient_scope" });
    expect(() => createMcpToken({ wallet: "0xabc", label: "raw", scopes: ["base:transfer"] })).toThrow(/unsupported scope/);
  });

  it("rotates by revoking the old token and returning a new show-once token", () => {
    const created = createMcpToken({ wallet: "0xabc", label: "agent", scopes: ["graph:read"], expiresInDays: 30 });
    const rotated = rotateMcpToken("0xabc", created.record.id);

    expect(rotated).not.toBeNull();
    expect(verifyMcpToken(created.token, "graph:read")).toMatchObject({ ok: false, code: "revoked" });
    expect(verifyMcpToken(rotated!.token, "graph:read").ok).toBe(true);
    expect(listMcpTokens("0xabc").filter((t) => !t.revokedAt)).toHaveLength(1);
  });
});
