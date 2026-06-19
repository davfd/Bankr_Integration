// Wallet-keyed usage metering, write-behind. When the dedicated Supabase
// project exists (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY), rows land in
// public.usage_events (migration 0002); until then we emit a structured log
// line. Fire-and-forget: metering must never fail a paid request.

export type UsageEvent = {
  wallet: string;
  kind: string; // 'chat' | 'council' | 'council_panel' | …
  units: number; // tokens for chat; 1 per call for council
  leo_cost?: number;
};

export type UsageLogger = (e: UsageEvent) => void;

export const logUsage: UsageLogger = (e) => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // eslint-disable-next-line no-console
    console.log(`[usage] wallet=${e.wallet} kind=${e.kind} units=${e.units}`);
    return;
  }
  fetch(`${url}/rest/v1/usage_events`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ wallet: e.wallet, kind: e.kind, units: e.units, leo_cost: e.leo_cost ?? 0 }),
  }).catch(() => {});
};
