import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendHistory,
  listHistory,
  listConversations,
  getConversation,
  putConversation,
  deleteConversation,
} from "./history";
import { createGatewayApp } from "./app";

const W1 = "0xaaaa000000000000000000000000000000000001";
const W2 = "0xbbbb000000000000000000000000000000000002";

beforeEach(() => {
  delete process.env.GATEWAY_TOKEN;
  process.env.HISTORY_ROOT = mkdtempSync(join(tmpdir(), "hist-"));
});

describe("history store", () => {
  it("appends and lists per wallet, newest first, filtered by kind", () => {
    appendHistory(W1, { kind: "graph", q: "memory", a: "3 hits" });
    appendHistory(W1, { kind: "council", q: "idea", a: "REVISE" });
    appendHistory(W2, { kind: "graph", q: "other-wallet", a: "x" });
    const all = listHistory(W1);
    expect(all).toHaveLength(2);
    expect(all[0]!.kind).toBe("council"); // newest first
    expect(listHistory(W1, "graph")).toHaveLength(1);
    expect(listHistory(W2)).toHaveLength(1); // isolation
    expect(listHistory(W2)[0]!.q).toBe("other-wallet");
  });

  it("rejects malformed wallets", () => {
    expect(() => appendHistory("../etc", { kind: "x", q: "q", a: "a" })).toThrow();
  });
});

describe("conversations store", () => {
  it("save / list / get / delete round-trip, per wallet", () => {
    const id = "11111111-aaaa-bbbb-cccc-000000000001";
    putConversation(W1, id, { title: "True names", items: [{ kind: "user", text: "hi" }], history: [{ role: "user", content: "hi" }] });
    expect(listConversations(W1)).toHaveLength(1);
    expect(listConversations(W2)).toHaveLength(0);
    const conv = getConversation(W1, id) as { title: string; items: unknown[] };
    expect(conv.title).toBe("True names");
    expect(conv.items).toHaveLength(1);
    deleteConversation(W1, id);
    expect(listConversations(W1)).toHaveLength(0);
  });

  it("rejects bad ids", () => {
    expect(() => putConversation(W1, "../../x", { title: "t" })).toThrow();
  });
});

describe("history routes · session-gated", () => {
  const SECRET = "hist-test-secret";
  const token = (wallet: string) => {
    const exp = Date.now() + 60_000;
    const normalized = wallet.toLowerCase();
    const payload = `leo2.${normalized}.${exp}.holder`;
    const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
    return `${payload}.${sig}`;
  };

  it("401 without session; full round-trip with one", async () => {
    process.env.SESSION_SECRET = SECRET;
    const app = createGatewayApp({ meter: false });
    expect((await app.request("/api/history")).status).toBe(401);

    const h = { "x-leo-session": token(W1), "content-type": "application/json" };
    const post = await app.request("/api/history", { method: "POST", headers: h, body: JSON.stringify({ kind: "trust", q: "agent #1", a: "avg 4.2" }) });
    expect(post.status).toBe(200);
    const list = (await (await app.request("/api/history?kind=trust", { headers: h })).json()) as { entries: { q: string }[] };
    expect(list.entries[0]!.q).toBe("agent #1");

    const cid = "22222222-aaaa-bbbb-cccc-000000000002";
    const put = await app.request(`/api/conversations/${cid}`, { method: "PUT", headers: h, body: JSON.stringify({ title: "T", items: [], history: [] }) });
    expect(put.status).toBe(200);
    const convs = (await (await app.request("/api/conversations", { headers: h })).json()) as { conversations: { id: string }[] };
    expect(convs.conversations[0]!.id).toBe(cid);
    expect((await app.request(`/api/conversations/${cid}`, { headers: h })).status).toBe(200);
    expect((await app.request(`/api/conversations/${cid}`, { method: "DELETE", headers: h })).status).toBe(200);
  });
});
