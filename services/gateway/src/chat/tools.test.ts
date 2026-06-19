import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { dispatchFreeTool } from "./tools";

const deps = { graphSearch: async () => [] };

beforeEach(() => {
  delete process.env.WORKSHOP_SIDECAR_URL;
});

afterEach(() => {
  delete process.env.WORKSHOP_SIDECAR_URL;
  vi.unstubAllGlobals();
});

describe("workshop_research dispatch", () => {
  it("returns the honest coming-soon payload when no sidecar is configured", async () => {
    const out = (await dispatchFreeTool("workshop_research", { topic: "x" }, deps)) as { status: string };
    expect(out.status).toBe("coming_soon");
  });

  it("proxies to the sidecar when configured", async () => {
    process.env.WORKSHOP_SIDECAR_URL = "http://sidecar.test";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("http://sidecar.test/research");
      expect(JSON.parse(String(init?.body)).topic).toBe("true name");
      return new Response(JSON.stringify({ ok: true, concept: "true name", counts: { mentions: 893 } }), {
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = (await dispatchFreeTool("workshop_research", { topic: "true name" }, deps)) as {
      ok: boolean;
      counts: { mentions: number };
    };
    expect(out.ok).toBe(true);
    expect(out.counts.mentions).toBe(893);
  });

  it("maps sidecar failure to an honest error payload", async () => {
    process.env.WORKSHOP_SIDECAR_URL = "http://sidecar.test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const out = (await dispatchFreeTool("workshop_research", { topic: "x" }, deps)) as { status: string };
    expect(out.status).toBe("error");
  });
});

describe("deep graph tools", () => {
  it("graph_concept hits the sidecar /graph/concept endpoint", async () => {
    process.env.WORKSHOP_SIDECAR_URL = "http://sidecar.test";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("http://sidecar.test/graph/concept");
      expect(JSON.parse(String(init?.body)).name).toBe("memory palace");
      return new Response(JSON.stringify({ ok: true, mentions: [{ author: "Cicero", work: "De Oratore" }] }), {
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = (await dispatchFreeTool("graph_concept", { name: "memory palace" }, deps)) as { ok: boolean; mentions: unknown[] };
    expect(out.ok).toBe(true);
    expect(out.mentions).toHaveLength(1);
  });

  it("graph_related and graph_bible route to their endpoints", async () => {
    process.env.WORKSHOP_SIDECAR_URL = "http://sidecar.test";
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      paths.push(url);
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }));
    await dispatchFreeTool("graph_related", { name: "true name" }, deps);
    await dispatchFreeTool("graph_bible", { name: "true name" }, deps);
    expect(paths).toEqual(["http://sidecar.test/graph/related", "http://sidecar.test/graph/bible"]);
  });

  it("returns unavailable (not a crash) when no sidecar is set", async () => {
    const out = (await dispatchFreeTool("graph_concept", { name: "x y" }, deps)) as { status: string };
    expect(out.status).toBe("unavailable");
  });

  it("guards a too-short concept name", async () => {
    process.env.WORKSHOP_SIDECAR_URL = "http://sidecar.test";
    const out = (await dispatchFreeTool("graph_concept", { name: "a" }, deps)) as { status: string };
    expect(out.status).toBe("error");
  });
});

describe("council_memory dispatch", () => {
  it("uses the injected searcher and returns hits", async () => {
    const out = (await dispatchFreeTool(
      "council_memory",
      { query: "agent identity" },
      { ...deps, searchCouncil: (q: string) => [{ ts: "t", idea: `re:${q}`, mode: "panel", ruling: "ACCEPT", seats: ["philo"], score: 2 }] },
    )) as { hits: { ruling: string }[] };
    expect(out.hits[0]!.ruling).toBe("ACCEPT");
  });

  it("notes when the Council has nothing close", async () => {
    const out = (await dispatchFreeTool(
      "council_memory",
      { query: "obscure topic" },
      { ...deps, searchCouncil: () => [] },
    )) as { hits: unknown[]; note?: string };
    expect(out.hits).toHaveLength(0);
    expect(out.note).toContain("hasn't deliberated");
  });
});
