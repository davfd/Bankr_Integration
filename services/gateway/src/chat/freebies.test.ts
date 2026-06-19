import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifySessionToken, freeRemaining, consumeFree, _resetFreebies, FREE_PROMPTS } from "./freebies";
import { createGatewayApp } from "../app";

const SECRET = "test-session-secret";
function mintToken(wallet: string, expMs = Date.now() + 60_000): string {
  const normalized = wallet.toLowerCase();
  const payload = `leo2.${normalized}.${expMs}.holder`;
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function legacyToken(wallet: string, expMs = Date.now() + 60_000): string {
  const normalized = wallet.toLowerCase();
  const sig = createHmac("sha256", SECRET).update(`${normalized}.${expMs}`).digest("hex");
  return `${normalized}.${expMs}.${sig}`;
}

function tokenWithExp(wallet: string, exp: string): string {
  const normalized = wallet.toLowerCase();
  const payload = `leo2.${normalized}.${exp}.holder`;
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

beforeEach(() => {
  delete process.env.GATEWAY_TOKEN;
  process.env.SESSION_SECRET = SECRET;
  process.env.FREEBIE_STORE = join(mkdtempSync(join(tmpdir(), "freebies-")), "f.json");
  _resetFreebies();
});

describe("freebies · session verification", () => {
  it("accepts a valid token and lowercases the wallet", () => {
    expect(verifySessionToken(mintToken("0xAbC1000000000000000000000000000000000001"))).toBe(
      "0xabc1000000000000000000000000000000000001",
    );
  });

  it("rejects forged, expired, and malformed tokens", () => {
    const t = mintToken("0xabc1000000000000000000000000000000000001");
    expect(verifySessionToken(t.slice(0, -2) + "ff")).toBeNull(); // tampered sig
    expect(verifySessionToken(mintToken("0xabc", Date.now() - 1000))).toBeNull(); // expired
    expect(verifySessionToken(tokenWithExp("0xabc1000000000000000000000000000000000001", "Infinity"))).toBeNull();
    expect(verifySessionToken(tokenWithExp("0xabc1000000000000000000000000000000000001", "NaN"))).toBeNull();
    expect(verifySessionToken(legacyToken("0xabc1000000000000000000000000000000000001"))).toBeNull();
    expect(verifySessionToken("nope")).toBeNull();
    expect(verifySessionToken(undefined)).toBeNull();
  });

  it("counts down and persists", () => {
    const w = "0xabc1000000000000000000000000000000000001";
    expect(freeRemaining(w)).toBe(FREE_PROMPTS);
    expect(consumeFree(w)).toBe(FREE_PROMPTS - 1);
    _resetFreebies(); // reload from disk
    expect(freeRemaining(w)).toBe(FREE_PROMPTS - 1);
  });
});

describe("freebies · through the metered chat route", () => {
  const scriptedAnthropic = {
    messages: {
      stream() {
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: "content_block_delta", delta: { type: "text_delta", text: "ok" } };
          },
          async finalMessage() {
            return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 2 } };
          },
        };
      },
    },
  };
  const wallet = "0xfree000000000000000000000000000000000001";
  const post = (app: ReturnType<typeof createGatewayApp>, headers: Record<string, string> = {}) =>
    app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });

  it("grants FREE_PROMPTS messages with a valid session, then 402s", async () => {
    const app = createGatewayApp({ meter: true, anthropic: scriptedAnthropic });
    const token = mintToken(wallet);
    for (let i = 0; i < FREE_PROMPTS; i++) {
      const res = await post(app, { "x-leo-session": token });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain(`"type":"free"`);
      expect(text).toContain(`"remaining":${FREE_PROMPTS - 1 - i}`);
    }
    const exhausted = await post(app, { "x-leo-session": token });
    expect(exhausted.status).toBe(402); // paywall takes over
  });

  it("no session → straight 402; forged session → 402", async () => {
    const app = createGatewayApp({ meter: true, anthropic: scriptedAnthropic });
    expect((await post(app)).status).toBe(402);
    const forged = mintToken(wallet).slice(0, -4) + "beef";
    expect((await post(app, { "x-leo-session": forged })).status).toBe(402);
  });

  it("unmetered (dev) mode never consumes freebies", async () => {
    const app = createGatewayApp({ meter: false, anthropic: scriptedAnthropic });
    const res = await post(app, { "x-leo-session": mintToken(wallet) });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(`"type":"free"`);
    expect(freeRemaining(wallet)).toBe(FREE_PROMPTS);
  });
});
