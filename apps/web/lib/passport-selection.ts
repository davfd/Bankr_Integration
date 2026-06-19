export const ACTIVE_AGENT_PASSPORT_STORAGE_KEY = "leo_agent_passport_id";

export function readActiveAgentPassportId(): string | null {
  if (typeof localStorage === "undefined") return null;
  const value = localStorage.getItem(ACTIVE_AGENT_PASSPORT_STORAGE_KEY)?.trim() ?? "";
  return /^\d+$/.test(value) ? value : null;
}

export function setActiveAgentPassportId(passportId: string): void {
  if (typeof localStorage === "undefined") return;
  const value = passportId.trim();
  if (!/^\d+$/.test(value)) return;
  localStorage.setItem(ACTIVE_AGENT_PASSPORT_STORAGE_KEY, value);
}
