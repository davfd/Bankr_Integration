// Per-wallet activity history + saved conversations, file-backed (same pattern
// as freebies.ts; migrates to the platform DB when it exists). Two stores:
//  - history:       ~/.leonardo-platform/history/<wallet>.json
//                    [{id, ts, kind, q, a}] — every surface appends here
//                    (graph, council, workshop, agent, trust, passport, chat)
//  - conversations: ~/.leonardo-platform/conversations/<wallet>/<id>.json
//                    client-saved chat threads → multi-conversation
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const HISTORY_CAP = 200;
const CONV_CAP = 50;
const CONV_MAX_BYTES = 512_000;

function root(): string {
  return process.env.HISTORY_ROOT ?? join(homedir(), ".leonardo-platform");
}

function safeWallet(wallet: string): string {
  const w = wallet.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(w)) throw new Error("invalid wallet");
  return w;
}
function safeId(id: string): string {
  if (!/^[a-z0-9-]{1,64}$/.test(id)) throw new Error("invalid id");
  return id;
}

export type HistoryEntry = { id: string; ts: string; kind: string; q: string; a: string };

export function appendHistory(wallet: string, e: { kind: string; q: string; a: string }): HistoryEntry {
  const w = safeWallet(wallet);
  const dir = join(root(), "history");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${w}.json`);
  let list: HistoryEntry[] = [];
  try {
    list = JSON.parse(readFileSync(file, "utf8")) as HistoryEntry[];
  } catch {
    list = [];
  }
  const entry: HistoryEntry = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    kind: String(e.kind).slice(0, 24),
    q: String(e.q).slice(0, 500),
    a: String(e.a).slice(0, 1500),
  };
  list.push(entry);
  if (list.length > HISTORY_CAP) list = list.slice(-HISTORY_CAP);
  writeFileSync(file, JSON.stringify(list), "utf8");
  return entry;
}

export function listHistory(wallet: string, kind?: string, limit = 50): HistoryEntry[] {
  const w = safeWallet(wallet);
  try {
    let list = JSON.parse(readFileSync(join(root(), "history", `${w}.json`), "utf8")) as HistoryEntry[];
    if (kind) list = list.filter((e) => e.kind === kind);
    return list.slice(-limit).reverse();
  } catch {
    return [];
  }
}

export type ConversationMeta = { id: string; title: string; updated: string };

function convDir(wallet: string): string {
  return join(root(), "conversations", safeWallet(wallet));
}

export function listConversations(wallet: string): ConversationMeta[] {
  const dir = convDir(wallet);
  if (!existsSync(dir)) return [];
  const metas: ConversationMeta[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const d = JSON.parse(readFileSync(join(dir, f), "utf8")) as { id: string; title?: string; updated?: string };
      metas.push({ id: d.id, title: d.title ?? "Untitled", updated: d.updated ?? "" });
    } catch {
      // skip corrupt file
    }
  }
  return metas.sort((a, b) => (b.updated > a.updated ? 1 : -1));
}

export function getConversation(wallet: string, id: string): unknown | null {
  try {
    return JSON.parse(readFileSync(join(convDir(wallet), `${safeId(id)}.json`), "utf8"));
  } catch {
    return null;
  }
}

export function putConversation(
  wallet: string,
  id: string,
  data: { title?: string; items?: unknown[]; history?: unknown[]; summary?: string },
): ConversationMeta {
  const dir = convDir(wallet);
  mkdirSync(dir, { recursive: true });
  const cid = safeId(id);
  const doc = {
    id: cid,
    title: String(data.title ?? "Untitled").slice(0, 80),
    updated: new Date().toISOString(),
    items: data.items ?? [],
    history: data.history ?? [],
    summary: typeof data.summary === "string" ? data.summary.slice(0, 4000) : "",
  };
  const json = JSON.stringify(doc);
  if (json.length > CONV_MAX_BYTES) throw new Error("conversation too large");
  // Cap the number of saved conversations: drop the oldest beyond the cap.
  const metas = listConversations(wallet).filter((m) => m.id !== cid);
  for (const old of metas.slice(CONV_CAP - 1)) {
    rmSync(join(dir, `${old.id}.json`), { force: true });
  }
  writeFileSync(join(dir, `${cid}.json`), json, "utf8");
  return { id: cid, title: doc.title, updated: doc.updated };
}

export function deleteConversation(wallet: string, id: string): void {
  rmSync(join(convDir(wallet), `${safeId(id)}.json`), { force: true });
}
