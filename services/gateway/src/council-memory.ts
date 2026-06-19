// Council memory: a searchable, gateway-owned log of every Council run, so
// Leonardo can recall past deliberations in chat (the council_memory tool) and
// cite a prior ruling instead of convening a fresh paid panel. File-backed
// (same pattern as history.ts), full-text (NOT truncated like the per-wallet
// history's 1500-char answers), global across wallets — strictly more useful and
// safe while the platform is owner-locked. Each record carries `wallet` so a
// per-wallet/opt-in-shared flip at public launch needs no migration.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const CAP = 1000;
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "is", "it",
  "this", "that", "with", "as", "at", "by", "be", "are", "was", "what", "how",
  "council", "idea", "review", "say", "said", "about",
]);

function root(): string {
  return process.env.HISTORY_ROOT ?? join(homedir(), ".leonardo-platform");
}
function file(): string {
  return join(root(), "council-memory", "log.json");
}

export type CouncilRecord = {
  id: string;
  ts: string;
  wallet: string | null;
  idea: string;
  mode: "quick" | "panel";
  verdicts: { seat: string; verdict: string }[];
  synthesis: string;
};

function load(): CouncilRecord[] {
  try {
    return JSON.parse(readFileSync(file(), "utf8")) as CouncilRecord[];
  } catch {
    return [];
  }
}

/** Capture a Council run. Full text (idea/verdicts/synthesis bounded but generous). */
export function recordCouncil(r: {
  wallet?: string | null;
  idea: string;
  mode: "quick" | "panel";
  verdicts?: { seat: string; verdict: string }[];
  synthesis?: string;
}): CouncilRecord {
  mkdirSync(join(root(), "council-memory"), { recursive: true });
  const list = load();
  const rec: CouncilRecord = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    wallet: r.wallet ? r.wallet.toLowerCase() : null,
    idea: String(r.idea).slice(0, 4000),
    mode: r.mode,
    verdicts: (r.verdicts ?? []).map((v) => ({
      seat: String(v.seat).slice(0, 40),
      verdict: String(v.verdict).slice(0, 4000),
    })),
    synthesis: String(r.synthesis ?? "").slice(0, 4000),
  };
  list.push(rec);
  writeFileSync(file(), JSON.stringify(list.length > CAP ? list.slice(-CAP) : list), "utf8");
  return rec;
}

export type CouncilHit = {
  ts: string;
  idea: string;
  mode: "quick" | "panel";
  ruling: string; // synthesis, or the first verdict for a quick review
  seats: string[];
  score: number;
};

/**
 * Keyword + recency search over stored Council runs. Cheap, standalone (no
 * embeddings). Scores by shared significant terms across idea/synthesis/verdicts,
 * with a light recency tie-breaker so a fresh, equally-relevant ruling wins.
 */
export function searchCouncilMemory(query: string, opts: { limit?: number } = {}): CouncilHit[] {
  const limit = opts.limit ?? 5;
  const terms = String(query)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  if (terms.length === 0) return [];
  const uniq = [...new Set(terms)];
  const list = load();
  const now = Date.now();

  const scored = list.map((r) => {
    const hay = `${r.idea} ${r.synthesis} ${r.verdicts.map((v) => v.verdict).join(" ")}`.toLowerCase();
    let score = 0;
    for (const t of uniq) if (hay.includes(t)) score += 1;
    // Recency nudge: up to +0.5 for the last ~30 days, fades after.
    const ageDays = (now - Date.parse(r.ts)) / 86_400_000;
    if (Number.isFinite(ageDays)) score += 0.5 * Math.max(0, 1 - ageDays / 30);
    return { r, score };
  });

  return scored
    .filter((s) => s.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r, score }) => ({
      ts: r.ts,
      idea: r.idea.slice(0, 300),
      mode: r.mode,
      ruling: (r.synthesis || r.verdicts[0]?.verdict || "").slice(0, 800),
      seats: r.verdicts.map((v) => v.seat),
      score: Math.round(score * 100) / 100,
    }));
}

export type CouncilSearcher = (query: string) => CouncilHit[];
