// Client for the gateway's hosted-agent routes (session-gated; the wallet IS
// the tenant). Free in beta; usage is logged per wallet.
import { GATEWAY_URL, authHeaders } from "./gateway";

function sessionHeaders(): Record<string, string> {
  const s = typeof localStorage !== "undefined" ? localStorage.getItem("leo_session") : null;
  return authHeaders({ "content-type": "application/json", ...(s ? { "x-leo-session": s } : {}) });
}

export type HostedAgentStatus = { provisioned: boolean; createdAt?: string; prompts?: number; lastPromptAt?: string };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${GATEWAY_URL}${path}`, { ...init, headers: sessionHeaders() });
  } catch {
    throw new Error("Can't reach the platform right now.");
  }
  const j = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (res.status === 401) throw new Error("Sign in with your wallet first.");
  if (!res.ok && !(j as { blocked?: boolean }).blocked) throw new Error(j.error ?? `Error (${res.status}).`);
  return j;
}

export const hostedAgent = {
  status: () => call<HostedAgentStatus & { ok: boolean }>("/api/agent/status"),
  provision: () => call<HostedAgentStatus & { ok: boolean }>("/api/agent/provision", { method: "POST" }),
  prompt: (prompt: string) =>
    call<{ ok: boolean; reply: string; ms: number }>("/api/agent/prompt", { method: "POST", body: JSON.stringify({ prompt }) }),
  trySpend: () => call<{ ok: boolean; blocked?: boolean; error?: string }>("/api/agent/spend", { method: "POST" }),
};
