// Security middleware for the public gateway: constant-time auth compare,
// a strict CORS allowlist, an in-memory per-IP rate limiter, and hardening
// response headers. The gateway is internet-reachable (cloudflared tunnel),
// so these are load-bearing, not decorative.
import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";

/** Constant-time string comparison — avoids leaking the token via timing. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false; // token length is fixed; negligible leak
  return timingSafeEqual(ab, bb);
}

/**
 * CORS origin allow-decision. Allows localhost (any port), *.vercel.app, and any
 * origin listed in GATEWAY_ALLOWED_ORIGINS (comma-separated). Everything else is
 * denied (no ACAO header). Non-browser callers (no Origin) need no CORS header.
 */
export function corsOrigin(origin: string): string | null {
  if (!origin) return null;
  const extra = (process.env.GATEWAY_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const isVercel = /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin);
  return isLocal || isVercel || extra.includes(origin) ? origin : null;
}

/** Per-IP sliding-window rate limiter (in-memory; single-process beta gateway). */
export function rateLimit(opts: { windowMs?: number; max?: number } = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? Number(process.env.GATEWAY_RATE_LIMIT ?? 120);
  const hits = new Map<string, number[]>();
  return async (c: Context, next: Next) => {
    const ip =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      "local";
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      c.header("Retry-After", String(Math.ceil(windowMs / 1000)));
      return c.json({ ok: false, error: "rate limited" }, 429);
    }
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
    }
    return next();
  };
}

/**
 * Decode the payer (the `from` address) out of an x402 `X-Payment` header
 * (base64 JSON → payload.authorization.from). Returns lowercased address or null.
 * Lets the gateway enforce a payer allowlist before the payment is settled.
 */
export function decodeX402Payer(header: string | undefined): string | null {
  if (!header) return null;
  try {
    const json = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    const from = json?.payload?.authorization?.from;
    return typeof from === "string" ? from.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Conservative hardening headers on every response (API, no embedding, no caching). */
export async function securityHeaders(c: Context, next: Next): Promise<void> {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
}
