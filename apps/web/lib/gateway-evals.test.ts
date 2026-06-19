import { afterEach, describe, expect, it, vi } from "vitest";
import { createEvalRun, fetchCompleteRunData, fetchEvalCouncilPacket, listEvalRecipes } from "./gateway";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function headerValue(init: RequestInit | undefined, name: string): string | null {
  const headers = init?.headers;
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) return new Headers(headers).get(name);
  return (headers as Record<string, string>)[name] ?? null;
}

class MemoryStorage {
  data = new Map<string, string>();
  getItem = vi.fn((key: string) => this.data.get(key) ?? null);
  setItem = vi.fn((key: string, value: string) => { this.data.set(key, value); });
  removeItem = vi.fn((key: string) => { this.data.delete(key); });
  clear = vi.fn(() => { this.data.clear(); });
}

describe("Repro Lab gateway client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("lists eval recipes from the gateway", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: string, init?: RequestInit) => {
      calls.push({ input, init });
      return jsonResponse({ ok: true, recipes: [{ id: "gemma4-seed-harmbench", model_slug: "gemma-4-uncensored" }] });
    };

    const recipes = await listEvalRecipes({ fetchImpl });

    expect(recipes[0]?.id).toBe("gemma4-seed-harmbench");
    expect(calls[0]?.input).toContain("/api/evals/recipes");
  });

  it("creates a smoke run and turns 401 into a sign-in error", async () => {
    const bodies: string[] = [];
    const okFetch = async (_input: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return jsonResponse({ ok: true, run_id: "eval_1", status: "completed", receipt_sha256: "a".repeat(64) });
    };
    const run = await createEvalRun("gemma4-seed-harmbench", "smoke", { fetchImpl: okFetch });
    expect(run.run_id).toBe("eval_1");
    expect(JSON.parse(bodies[0] ?? "{}")).toEqual({ recipe_id: "gemma4-seed-harmbench", mode: "smoke" });

    const deniedFetch = async () => jsonResponse({ ok: false, error: "sign in first" }, 401);
    await expect(createEvalRun("gemma4-seed-harmbench", "smoke", { fetchImpl: deniedFetch })).rejects.toThrow(/wallet is connected/i);
  });

  it("does not mislabel gateway bearer-token rejection as wallet sign-in", async () => {
    const deniedFetch = async () => jsonResponse({ ok: false, error: "unauthorized" }, 401);

    await expect(createEvalRun("gemma4-seed-harmbench", "smoke", { fetchImpl: deniedFetch })).rejects.toThrow(/gateway authorization/i);
  });

  it("creates a random sample run request with bounded sample fields", async () => {
    const bodies: string[] = [];
    const fetchImpl = async (_input: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return jsonResponse({ ok: true, run_id: "eval_sample_1", mode: "sample", status: "completed", receipt_sha256: "c".repeat(64) });
    };

    const run = await createEvalRun("gemma4-seed-harmbench", "sample", {
      fetchImpl,
      sample_size: 5,
      sample_seed: "visible-council-random",
      splits: ["standard", "contextual"],
    });

    expect(run.run_id).toBe("eval_sample_1");
    expect(JSON.parse(bodies[0] ?? "{}")).toEqual({
      recipe_id: "gemma4-seed-harmbench",
      mode: "sample",
      sample_size: 5,
      sample_seed: "visible-council-random",
      splits: ["standard", "contextual"],
    });
  });

  it("recovers the cookie-backed session token before creating an eval run", async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("/api/auth/token");
      return jsonResponse({ ok: true, token: "signed-session-token" });
    }));
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: string, init?: RequestInit) => {
      calls.push({ input, init });
      return jsonResponse({ ok: true, run_id: "eval_cookie_1", mode: "sample", status: "completed", receipt_sha256: "d".repeat(64) });
    };

    const run = await createEvalRun("gemma4-seed-harmbench", "sample", { fetchImpl, sample_size: 1 });

    expect(run.run_id).toBe("eval_cookie_1");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith("leo_session", "signed-session-token");
    expect(headerValue(calls[0]?.init, "x-leo-session")).toBe("signed-session-token");
  });

  it("fetches the complete run tab data with pagination and split filters", async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: string) => {
      calls.push(input);
      return jsonResponse({
        ok: true,
        data: {
          run_id: "tp5-v6-r6-joseph-arch-gated-guard-4x100-20260609T221315Z",
          total_cases: 400,
          returned: 1,
          offset: 25,
          limit: 25,
          rows: [{ case_ref: "standard:aaaaaaaaaaaa", split: "standard", baseline_refused: false, seed_refused: true }],
        },
      });
    };

    const data = await fetchCompleteRunData({ fetchImpl, split: "standard", offset: 25, limit: 25 });

    expect(data.total_cases).toBe(400);
    expect(data.rows[0]?.case_ref).toBe("standard:aaaaaaaaaaaa");
    expect(calls[0]).toContain("/api/evals/complete-run");
    expect(calls[0]).toContain("split=standard");
    expect(calls[0]).toContain("offset=25");
    expect(calls[0]).toContain("limit=25");
  });

  it("fetches the redacted Council packet for a completed eval run", async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: string) => {
      calls.push(input);
      return jsonResponse({
        ok: true,
        packet: {
          run_id: "eval_1",
          packet_sha256: "b".repeat(64),
          visibility: "redacted_receipt_only",
          council_packet: "Council Repro Review Packet",
        },
      });
    };

    const packet = await fetchEvalCouncilPacket("eval_1", { fetchImpl });

    expect(packet.packet_sha256).toBe("b".repeat(64));
    expect(packet.council_packet).toContain("Council Repro Review Packet");
    expect(calls[0]).toContain("/api/evals/runs/eval_1/council-packet");
  });
});
