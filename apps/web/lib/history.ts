// Client for the per-wallet history + saved conversations (gateway-backed).
import { GATEWAY_URL, authHeaders } from "./gateway";

export type HistoryEntry = { id: string; ts: string; kind: string; q: string; a: string };
export type ConversationMeta = { id: string; title: string; updated: string };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: authHeaders({ "content-type": "application/json" }),
  });
  if (res.status === 401) throw new Error("Sign in with your wallet first.");
  const j = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok) throw new Error(j.error ?? `Error (${res.status}).`);
  return j;
}

export const history = {
  list: (kind?: string) =>
    call<{ entries: HistoryEntry[] }>(`/api/history${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`).then((r) => r.entries),
  add: (kind: string, q: string, a: string) =>
    call("/api/history", { method: "POST", body: JSON.stringify({ kind, q, a }) }).catch(() => {}),
};

export const conversations = {
  list: () => call<{ conversations: ConversationMeta[] }>("/api/conversations").then((r) => r.conversations),
  get: <T>(id: string) => call<{ conversation: T }>(`/api/conversations/${id}`).then((r) => r.conversation),
  save: (id: string, data: { title: string; items: unknown[]; history: unknown[]; summary?: string }) =>
    call(`/api/conversations/${id}`, { method: "PUT", body: JSON.stringify(data) }).catch(() => {}),
  remove: (id: string) => call(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => {}),
};
