import { describe, expect, it } from "vitest";
import { middleware } from "./middleware";
import { GATE_COOKIE, SESSION_COOKIE } from "./lib/session";

function req(path: string, opts: { host?: string; cookies?: Record<string, string> } = {}) {
  const url = new URL(path, `https://${opts.host ?? "app.leonardo-ai.io"}`);
  return {
    headers: new Headers({ host: opts.host ?? "app.leonardo-ai.io" }),
    nextUrl: {
      protocol: url.protocol,
      host: url.host,
      port: url.port,
      pathname: url.pathname,
      search: url.search,
      clone: () => new URL(url.toString()),
    },
    cookies: {
      get: (name: string) => {
        const value = opts.cookies?.[name];
        return value ? { name, value } : undefined;
      },
    },
  } as never;
}

describe("web middleware", () => {
  it("redirects unauthenticated page requests to /gate without needing SESSION_SECRET", async () => {
    const oldSecret = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try {
      const res = await middleware(req("/tools/graph?tab=complete"));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("https://app.leonardo-ai.io/gate?next=%2Ftools%2Fgraph%3Ftab%3Dcomplete");
    } finally {
      if (oldSecret) process.env.SESSION_SECRET = oldSecret;
    }
  });

  it("allows gate and auth routes without cookies", async () => {
    expect((await middleware(req("/gate"))).headers.get("x-middleware-next")).toBe("1");
    expect((await middleware(req("/api/auth"))).headers.get("x-middleware-next")).toBe("1");
  });

  it("allows page shell routing when both holder cookies are present", async () => {
    const res = await middleware(req("/tools/graph", { cookies: { [SESSION_COOKIE]: "session", [GATE_COOKIE]: "gate" } }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("canonicalizes vercel preview aliases before cookie checks", async () => {
    const res = await middleware(req("/tools/graph", { host: "leonardo-platform.vercel.app" }));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://app.leonardo-ai.io/tools/graph");
  });
});
