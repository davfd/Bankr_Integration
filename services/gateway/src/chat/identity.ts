// Wallet-scoped identity for the web Leonardo.
//
// Each beta member signs in with a wallet, so we can let Leonardo KNOW who he's
// talking to and recognize returning members — WITHOUT leaking one member into
// another (the cross-conversation bleed we already closed at the agent layer).
//
// We keep a small per-wallet file at ~/.leonardo-platform/identities/<wallet>.json
// holding first-seen/last-seen, a visit count, and a capped set of past-conversation
// summaries (the member's OWN). On a turn we hand the bridge a short preamble; the
// bridge injects it only when it opens a fresh ACP session, so Leonardo greets a
// known member and can recall the gist of their earlier chats — even across a
// server restart, since this is persisted to disk (the in-memory ACP session map
// is not).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function root(): string {
  return process.env.HISTORY_ROOT ?? join(homedir(), ".leonardo-platform");
}

function file(wallet: string): string {
  // wallets are 0x + 40 hex; lowercase + strip anything else so it's a safe filename
  const safe = wallet.toLowerCase().replace(/[^a-z0-9x]/g, "");
  return join(root(), "identities", `${safe}.json`);
}

const MAX_CONVERSATIONS = 6; // cap recalled past-conversation summaries

export type Identity = {
  wallet: string;
  first_seen: string;
  last_seen: string;
  visits: number;
  conversations: Record<string, { summary: string; ts: string }>;
};

function blank(wallet: string): Identity {
  const now = new Date().toISOString();
  return { wallet, first_seen: now, last_seen: now, visits: 0, conversations: {} };
}

export function loadIdentity(wallet: string): Identity {
  try {
    return JSON.parse(readFileSync(file(wallet), "utf8")) as Identity;
  } catch {
    return blank(wallet);
  }
}

function save(id: Identity): void {
  try {
    mkdirSync(join(root(), "identities"), { recursive: true });
    writeFileSync(file(id.wallet), JSON.stringify(id, null, 2));
  } catch {
    // identity is best-effort; never break a chat over it
  }
}

function shortWallet(w: string): string {
  return w.length > 12 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w;
}

/** A read-only context block the bridge prepends when it opens a fresh ACP
 *  session. Excludes the current conversation (its own history is already in the
 *  session). Returns "" when there's nothing identifying to say. */
export function buildPreamble(id: Identity, currentConversationId: string): string {
  const since = id.first_seen.slice(0, 10);
  const visit = id.visits + 1; // this turn opens the (visits+1)-th distinct conversation at most
  const past = Object.entries(id.conversations)
    .filter(([cid]) => cid !== currentConversationId)
    .reverse() // insertion order is oldest→newest; show most-recently-active first
    .slice(0, MAX_CONVERSATIONS)
    .map(([, c]) => c.summary)
    .filter((s) => s && s.trim());

  const lines = [
    "[MEMBER CONTEXT — read-only; for your awareness, do not quote verbatim or expose to anyone else]",
    `You are speaking with a recognized Leonardo beta member. Wallet: ${shortWallet(id.wallet)}.`,
    `Member since ${since}.${visit > 1 ? ` This is around conversation #${visit} with them.` : " This looks like their first conversation."}`,
  ];
  if (past.length) {
    lines.push("What you recall from their earlier conversations with you:");
    for (const s of past) lines.push(`- ${s.slice(0, 400)}`);
  }
  lines.push(
    "Greet them as a known member when natural. Never reveal another member's information or that other members exist.",
    "[/MEMBER CONTEXT]",
  );
  return lines.join("\n");
}

/** Build a one-line conversation summary deterministically (no LLM call, no added
 *  latency): the opening question as the topic anchor + the gist of the latest
 *  answer. Used so even a short conversation that never compacts leaves something
 *  recallable beyond "conversation #N". */
export function oneLineSummary(firstQuestion: string, latestAnswer: string): string {
  const clean = (s: string) =>
    (s || "")
      .replace(/```[\s\S]*?```/g, " ")          // drop code fences
      .replace(/[#*_>`|-]+/g, " ")               // drop markdown punctuation
      .replace(/\s+/g, " ")
      .trim();
  const q = clean(firstQuestion).slice(0, 90);
  const a = clean(latestAnswer);
  const firstSentence = (a.split(/(?<=[.!?])\s/)[0] || a).slice(0, 140);
  if (!q && !firstSentence) return "";
  if (!q) return `Leonardo discussed: ${firstSentence}`;
  if (!firstSentence) return `Asked about: ${q}`;
  return `Asked about "${q}" — Leonardo covered: ${firstSentence}`;
}

/** Record a finished turn: bump last-seen, count a new conversation, and store the
 *  conversation's running summary (the member's own) for future recall. */
export function recordTurn(wallet: string, conversationId: string, summary?: string): void {
  const id = loadIdentity(wallet);
  id.last_seen = new Date().toISOString();
  const isNewConversation = !(conversationId in id.conversations);
  if (isNewConversation) id.visits += 1;
  const existing = id.conversations[conversationId];
  const nextSummary = summary && summary.trim() ? summary.trim().slice(0, 600) : existing?.summary ?? "";
  // Re-insert at the end so object key order tracks ACTIVITY recency — robust even
  // when many turns share a millisecond (timestamp sorting is not).
  delete id.conversations[conversationId];
  id.conversations[conversationId] = { summary: nextSummary, ts: id.last_seen };
  // Bound the file: keep the MAX_CONVERSATIONS most-recently-active (insertion order).
  const entries = Object.entries(id.conversations);
  if (entries.length > MAX_CONVERSATIONS) {
    id.conversations = Object.fromEntries(entries.slice(-MAX_CONVERSATIONS));
  }
  save(id);
}
