"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useWalletClient } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { wrapFetchWithPayment } from "x402-fetch";
import { reviewIdea, reviewPanel, type GraphHit, type SeatVerdict } from "@/lib/gateway";
import {
  sendChat,
  appendAssistantText,
  appendToolRound,
  type ChatMessage,
  type ChatFrame,
  type PaidAction,
} from "@/lib/chat";
import { conversations, history as activityHistory, type ConversationMeta, type HistoryEntry } from "@/lib/history";

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/* ── thread items (render model) ───────────────────────────────────────── */
type Confirm = {
  action: PaidAction;
  price: string;
  tool_use_id: string;
  args: { idea: string; seat?: string };
  assistantContent: unknown[];
  state: "pending" | "running" | "done" | "declined" | "failed";
  error?: string;
};
type WorkshopBrief = {
  concept?: string;
  what_it_is?: string;
  modern_analogue?: string;
  bible_parallel?: string;
  risk?: string;
  counts?: Record<string, number>;
  sample_mentions?: { work: string; author: string; snippet: string }[];
  note?: string;
};
type Item =
  | { kind: "user"; text: string }
  | { kind: "leo"; text: string }
  | { kind: "graph"; query: string; hits: GraphHit[] | null } // null = searching
  | { kind: "council"; verdicts: SeatVerdict[]; synthesis?: string }
  | { kind: "workshop"; brief: WorkshopBrief | null } // null = researching
  | { kind: "notice"; text: string }
  | { kind: "confirm"; confirm: Confirm }
  | { kind: "error"; text: string };

/* ── wallet button (same pattern as /status and /gate) ─────────────────── */
function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const style = {
    border: "1px solid var(--inscription)",
    background: "rgba(212,194,154,0.06)",
    color: "var(--inscription)",
    borderRadius: 9999,
    padding: "0.6rem 1.25rem",
    fontSize: "0.66rem",
    letterSpacing: "0.2em",
    cursor: "pointer",
    minHeight: 44,
  } as const;
  if (isConnected) {
    return (
      <button className="display" style={style} onClick={() => disconnect()}>
        {short(address)} · SIGN OUT
      </button>
    );
  }
  return (
    <div style={{ position: "relative" }}>
      <button className="display" style={style} onClick={() => setOpen((o) => !o)}>
        {isPending ? "CONNECTING…" : "CONNECT WALLET"}
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 50, minWidth: 220, padding: 8, borderRadius: 14, border: "1px solid var(--marble-deep)", background: "var(--abyss)", boxShadow: "0 12px 44px rgba(0,0,0,0.55)" }}>
          {connectors.map((c) => (
            <button
              key={c.uid}
              className="display"
              onClick={() => connect({ connector: c }, { onSuccess: () => setOpen(false) })}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 10, border: "none", background: "transparent", color: "var(--marble)", fontSize: "0.74rem", letterSpacing: "0.05em", cursor: "pointer" }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── inline cards ──────────────────────────────────────────────────────── */
function GraphCard({ query, hits }: { query: string; hits: GraphHit[] | null }) {
  return (
    <div className="carved msg" style={{ padding: "0.9rem 1.1rem", margin: "6px 0" }}>
      <div className="mono" style={{ fontSize: "0.52rem", letterSpacing: "0.22em", color: "var(--inscription)", textTransform: "uppercase" }}>
        Imagination graph · “{query}”
      </div>
      {hits === null ? (
        <p style={{ color: "var(--marble-shadow)", fontSize: "0.82rem", margin: "8px 0 0" }}>Searching…</p>
      ) : hits.length === 0 ? (
        <p style={{ color: "var(--marble-shadow)", fontSize: "0.82rem", margin: "8px 0 0" }}>No concepts found.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 6 }}>
          {hits.slice(0, 8).map((h) => (
            <li key={h.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid rgba(168,159,140,0.1)", paddingBottom: 5 }}>
              <span style={{ color: "var(--marble)", fontSize: "0.85rem" }}>{h.name}</span>
              <span className="mono" style={{ color: "var(--ion)", fontSize: "0.68rem", whiteSpace: "nowrap" }}>{h.mentions.toLocaleString()}×</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CouncilCard({ verdicts, synthesis }: { verdicts: SeatVerdict[]; synthesis?: string }) {
  return (
    <div className="carved msg" style={{ padding: "1rem 1.2rem", margin: "6px 0" }}>
      <div className="mono" style={{ fontSize: "0.52rem", letterSpacing: "0.22em", color: "var(--inscription)", textTransform: "uppercase" }}>Council verdict</div>
      {synthesis && (
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.88rem", color: "var(--marble)", margin: "8px 0 0", lineHeight: 1.55 }}>{synthesis}</pre>
      )}
      {verdicts.map((v) => (
        <details key={v.seat} style={{ marginTop: 10 }}>
          <summary className="mono" style={{ fontSize: "0.62rem", letterSpacing: "0.12em", color: "var(--inscription)", textTransform: "capitalize", cursor: "pointer" }}>
            {v.seat}
          </summary>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.8rem", color: "var(--marble-shadow)", margin: "6px 0 0", lineHeight: 1.5 }}>{v.verdict}</pre>
        </details>
      ))}
    </div>
  );
}

function WorkshopCard({ brief }: { brief: WorkshopBrief | null }) {
  return (
    <div className="carved msg" style={{ padding: "1rem 1.2rem", margin: "6px 0", borderColor: "rgba(185,138,80,0.35)" }}>
      <div className="mono" style={{ fontSize: "0.52rem", letterSpacing: "0.22em", color: "var(--bronze)", textTransform: "uppercase" }}>
        Workshop brief{brief?.concept ? ` · ${brief.concept}` : ""}
      </div>
      {brief === null ? (
        <p style={{ color: "var(--marble-shadow)", fontSize: "0.82rem", margin: "8px 0 0" }}>Researching…</p>
      ) : brief.note ? (
        <p style={{ color: "var(--marble-shadow)", fontSize: "0.84rem", margin: "8px 0 0" }}>{brief.note}</p>
      ) : (
        <>
          {brief.what_it_is && <p style={{ color: "var(--marble)", fontSize: "0.86rem", margin: "8px 0 0", lineHeight: 1.55 }}>{brief.what_it_is}</p>}
          {brief.modern_analogue && (
            <p style={{ color: "var(--marble-shadow)", fontSize: "0.82rem", margin: "8px 0 0", lineHeight: 1.5 }}>
              <span style={{ color: "var(--inscription)" }}>Modern analogue · </span>{brief.modern_analogue}
            </p>
          )}
          {brief.bible_parallel && (
            <p style={{ color: "var(--marble-shadow)", fontSize: "0.82rem", margin: "6px 0 0" }}>
              <span style={{ color: "var(--inscription)" }}>Bible parallel · </span>{brief.bible_parallel}
            </p>
          )}
          {brief.risk && (
            <p style={{ color: "var(--marble-shadow)", fontSize: "0.82rem", margin: "6px 0 0", lineHeight: 1.5 }}>
              <span style={{ color: "var(--bronze)" }}>Top risk · </span>{brief.risk}
            </p>
          )}
          {brief.counts && (
            <p className="mono" style={{ fontSize: "0.6rem", letterSpacing: "0.1em", color: "var(--marble-deep)", margin: "10px 0 0" }}>
              {brief.counts.mentions ?? 0} mentions · {brief.counts.co_occurrences ?? 0} co-occurring · {brief.counts.bible_parallels ?? 0} bible parallels
            </p>
          )}
          {(brief.sample_mentions ?? []).slice(0, 3).map((m, i) => (
            <p key={i} style={{ color: "var(--marble-shadow)", fontSize: "0.78rem", margin: "8px 0 0", lineHeight: 1.5, borderLeft: "2px solid rgba(168,159,140,0.2)", paddingLeft: 10 }}>
              “{m.snippet}” <span className="mono" style={{ fontSize: "0.6rem", color: "var(--marble-deep)" }}>— {m.author}, {m.work}</span>
            </p>
          ))}
        </>
      )}
    </div>
  );
}

/* ── the chat page ─────────────────────────────────────────────────────── */
const CHIPS = [
  "Research: true-name power",
  "Research: identity concealment & impersonation",
  "Research: authentication & recognition protocol",
  "Research: identity erasure & name-taboo",
  "Research: oath-binding & fealty pledge",
  "Research: biometric identity & voice-print",
  "Research: surveillance & identity tracking",
];

export default function Chat() {
  const { isConnected } = useAccount();
  const { data: walletClient } = useWalletClient({ chainId: baseSepolia.id });
  const payFetch = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return walletClient ? (wrapFetchWithPayment(fetch, walletClient as any) as unknown as typeof fetch) : undefined;
  }, [walletClient]);

  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  // Running compaction summary: the gateway folds older turns into this and
  // returns it as a `compaction` frame; we cache it, drop the covered turns, and
  // replay it so long conversations survive without re-sending (or losing) the head.
  const [summary, setSummary] = useState<string>("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // History panel: browse past queries/answers, select entries as context.
  const [histOpen, setHistOpen] = useState(false);
  const [histEntries, setHistEntries] = useState<HistoryEntry[] | null>(null);
  const [histFilter, setHistFilter] = useState<string>("");
  const [selectedCtx, setSelectedCtx] = useState<Map<string, HistoryEntry>>(new Map());

  function openHistory() {
    setHistOpen((o) => !o);
    activityHistory.list().then(setHistEntries).catch(() => setHistEntries([]));
  }
  function toggleCtx(e: HistoryEntry) {
    setSelectedCtx((prev) => {
      const next = new Map(prev);
      if (next.has(e.id)) next.delete(e.id);
      else if (next.size < 5) next.set(e.id, e); // cap the context payload
      return next;
    });
  }
  function buildContextBlock(): string {
    if (selectedCtx.size === 0) return "";
    const lines = [...selectedCtx.values()].map(
      (e) => `[${e.kind}] Q: ${e.q.slice(0, 200)}\nA: ${e.a.slice(0, 300)}`,
    );
    return `Context from my saved history:\n${lines.join("\n---\n")}\n\n===\n`;
  }

  // Multi-conversation: every thread is saved per wallet on the platform.
  const [convId, setConvId] = useState<string>(() => crypto.randomUUID());
  const [convList, setConvList] = useState<ConversationMeta[]>([]);
  const [convOpen, setConvOpen] = useState(false);

  function refreshConvs() {
    conversations.list().then(setConvList).catch(() => {});
  }

  function newConversation() {
    setConvId(crypto.randomUUID());
    setItems([]);
    setHistory([]);
    setSummary("");
    setConvOpen(false);
  }

  async function openConversation(id: string) {
    try {
      const conv = await conversations.get<{ items?: Item[]; history?: ChatMessage[]; summary?: string }>(id);
      // Stale in-flight confirm cards can't resume across loads — mark expired.
      const loaded = (conv.items ?? []).map((it) =>
        it.kind === "confirm" && (it.confirm.state === "pending" || it.confirm.state === "running")
          ? { kind: "confirm" as const, confirm: { ...it.confirm, state: "failed" as const, error: "Expired — ask again." } }
          : it,
      );
      setItems(loaded);
      setHistory(conv.history ?? []);
      setSummary(conv.summary ?? "");
      setConvId(id);
      setConvOpen(false);
    } catch {
      // ignore
    }
  }

  // Autosave the thread (debounced) whenever a turn settles.
  useEffect(() => {
    if (busy || items.length === 0) return;
    const firstUser = items.find((it) => it.kind === "user") as { text?: string } | undefined;
    const title = (firstUser?.text ?? "Conversation").slice(0, 60);
    const t = setTimeout(() => {
      conversations.save(convId, { title, items, history, summary });
      refreshConvs();
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, history, busy, convId, summary]);

  // Self-heal sessions created before the free tier: fetch the session token
  // (cookie-authenticated) so the gateway can grant the free prompts.
  useEffect(() => {
    if (typeof localStorage === "undefined" || localStorage.getItem("leo_session")) return;
    fetch("/api/auth/token")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; token?: string } | null) => {
        if (j?.ok && j.token) localStorage.setItem("leo_session", j.token);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items]);

  function runTurn(turnHistory: ChatMessage[]) {
    setBusy(true);
    let leoText = "";
    let leoIdx = -1;
    let pendingDone = false;
    let compactThrough = 0; // messages the new summary now covers (dropped from the front)

    const onFrame = (f: ChatFrame) => {
      if (f.type === "text") {
        leoText += f.delta;
        setItems((prev) => {
          const next = [...prev];
          if (leoIdx === -1 || next[leoIdx]?.kind !== "leo") {
            leoIdx = next.length;
            next.push({ kind: "leo", text: leoText });
          } else {
            next[leoIdx] = { kind: "leo", text: leoText };
          }
          return next;
        });
      } else if (f.type === "tool_start" && f.name === "search_graph") {
        leoIdx = -1;
        const q = String((f.args as { query?: string })?.query ?? "");
        setItems((prev) => [...prev, { kind: "graph", query: q, hits: null }]);
      } else if (f.type === "tool_start" && f.name === "workshop_research") {
        leoIdx = -1;
        setItems((prev) => [...prev, { kind: "workshop", brief: null }]);
      } else if (f.type === "tool_result") {
        if (f.name === "search_graph") {
          const hits = ((f.payload as { hits?: GraphHit[] })?.hits ?? []) as GraphHit[];
          setItems((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              const it = next[i];
              if (it?.kind === "graph" && it.hits === null) {
                next[i] = { ...it, hits };
                break;
              }
            }
            return next;
          });
        } else if (f.name === "workshop_research") {
          const p = f.payload as WorkshopBrief & { ok?: boolean; message?: string; status?: string };
          setItems((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              const it = next[i];
              if (it?.kind === "workshop" && it.brief === null) {
                next[i] = p.ok ? { kind: "workshop", brief: p } : { kind: "notice", text: p.message ?? "The Workshop is unreachable." };
                return next;
              }
            }
            return p.ok ? [...next, { kind: "workshop", brief: p }] : [...next, { kind: "notice", text: p.message ?? "The Workshop is unreachable." }];
          });
        }
      } else if (f.type === "confirm_required") {
        // assistant_message frame follows; stash the confirm and fill content then.
        setItems((prev) => [
          ...prev,
          { kind: "confirm", confirm: { action: f.action, price: f.price, tool_use_id: f.tool_use_id, args: f.args, assistantContent: [], state: "pending" } },
        ]);
      } else if (f.type === "assistant_message") {
        setItems((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            const it = next[i];
            if (it?.kind === "confirm") {
              next[i] = { kind: "confirm", confirm: { ...it.confirm, assistantContent: f.content } };
              break;
            }
          }
          return next;
        });
      } else if (f.type === "compaction") {
        // Cache the running summary; remember how many old turns it now covers.
        compactThrough = f.throughCount;
        setSummary(f.summary);
      } else if (f.type === "error") {
        setItems((prev) => [...prev, { kind: "error", text: f.message }]);
      } else if (f.type === "done") {
        pendingDone = Boolean(f.pending);
      }
    };

    sendChat({ messages: turnHistory, summary, conversationId: convId, onFrame, fetchImpl: payFetch })
      .then(() => {
        // A pending turn's history is appended at confirm/decline time instead.
        if (!pendingDone) {
          const full = appendAssistantText(turnHistory, leoText);
          // If the gateway compacted, drop the summarized prefix so it isn't re-sent.
          setHistory(compactThrough > 0 ? full.slice(compactThrough) : full);
        }
      })
      .catch((e) => {
        setItems((prev) => [...prev, { kind: "error", text: e instanceof Error ? e.message : "Something broke." }]);
      })
      .finally(() => setBusy(false));
  }

  function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    // Selected history entries ride along as context (the model sees them;
    // the bubble shows only what you typed).
    const ctx = buildContextBlock();
    const turnHistory: ChatMessage[] = [...history, { role: "user", content: ctx + t }];
    setHistory(turnHistory);
    setItems((prev) => [
      ...prev,
      ...(selectedCtx.size > 0 ? [{ kind: "notice" as const, text: `📎 ${selectedCtx.size} history entr${selectedCtx.size === 1 ? "y" : "ies"} attached as context` }] : []),
      { kind: "user", text: t },
    ]);
    setSelectedCtx(new Map());
    runTurn(turnHistory);
  }

  function updateConfirm(toolUseId: string, patch: Partial<Confirm>) {
    setItems((prev) =>
      prev.map((it) => (it.kind === "confirm" && it.confirm.tool_use_id === toolUseId ? { kind: "confirm", confirm: { ...it.confirm, ...patch } } : it)),
    );
  }

  async function approveConfirm(c: Confirm) {
    updateConfirm(c.tool_use_id, { state: "running" });
    try {
      const result =
        c.action === "council_panel"
          ? await reviewPanel(c.args.idea, { fetchImpl: payFetch })
          : await reviewIdea(c.args.idea, { seat: c.args.seat, fetchImpl: payFetch });
      updateConfirm(c.tool_use_id, { state: "done" });
      if ("verdicts" in result) {
        setItems((prev) => [...prev, { kind: "council", verdicts: result.verdicts, synthesis: result.synthesis }]);
      } else {
        setItems((prev) => [...prev, { kind: "council", verdicts: [result] }]);
      }
      // Continuation: Leonardo narrates the verdict (a new paid message).
      const nextHistory = appendToolRound(history, c.assistantContent, c.tool_use_id, result);
      setHistory(nextHistory);
      runTurn(nextHistory);
    } catch (e) {
      updateConfirm(c.tool_use_id, { state: "failed", error: e instanceof Error ? e.message : "Payment failed." });
    }
  }

  function declineConfirm(c: Confirm) {
    updateConfirm(c.tool_use_id, { state: "declined" });
    // No auto-continuation (saves a message) — Leonardo sees the decline next turn.
    setHistory(appendToolRound(history, c.assistantContent, c.tool_use_id, "The user declined the charge.", true));
  }

  const composerDisabled = busy;

  return (
    <main style={{ position: "relative", zIndex: 2, height: "100dvh", display: "flex", flexDirection: "column", maxWidth: 820, margin: "0 auto", padding: "0 1rem" }}>
      {/* header */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "1.1rem 0", borderBottom: "1px solid rgba(168,159,140,0.14)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span className="display gold-leaf" style={{ fontSize: "1.05rem", letterSpacing: "0.3em" }}>LEONARDO</span>
          <div style={{ position: "relative", display: "inline-block" }}>
            <button
              className="mono"
              onClick={() => {
                setConvOpen((o) => !o);
                if (!convOpen) refreshConvs();
              }}
              style={{ background: "none", border: "none", fontSize: "0.58rem", letterSpacing: "0.18em", color: "var(--inscription)", cursor: "pointer", padding: 0 }}
            >
              CHATS ▾
            </button>
            {convOpen && (
              <div style={{ position: "absolute", left: 0, top: "calc(100% + 10px)", zIndex: 60, width: 280, maxHeight: 360, overflowY: "auto", padding: 8, borderRadius: 14, border: "1px solid var(--marble-deep)", background: "var(--abyss)", boxShadow: "0 12px 44px rgba(0,0,0,0.55)" }}>
                <button
                  className="display"
                  onClick={newConversation}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", borderRadius: 10, border: "1px dashed rgba(111,182,255,0.4)", background: "transparent", color: "var(--ion)", fontSize: "0.68rem", letterSpacing: "0.1em", cursor: "pointer", marginBottom: 6 }}
                >
                  + New conversation
                </button>
                {convList.length === 0 && (
                  <p style={{ color: "var(--marble-deep)", fontSize: "0.74rem", padding: "6px 10px", margin: 0 }}>No saved conversations yet.</p>
                )}
                {convList.map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      onClick={() => openConversation(c.id)}
                      style={{ flex: 1, textAlign: "left", padding: "8px 10px", borderRadius: 10, border: "none", background: c.id === convId ? "rgba(111,182,255,0.1)" : "transparent", color: "var(--marble)", fontSize: "0.78rem", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {c.title}
                    </button>
                    <button
                      aria-label="Delete conversation"
                      onClick={() => { conversations.remove(c.id); setConvList((p) => p.filter((x) => x.id !== c.id)); if (c.id === convId) newConversation(); }}
                      style={{ border: "none", background: "transparent", color: "var(--marble-deep)", cursor: "pointer", fontSize: "0.8rem", padding: "4px 6px" }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            className="mono"
            onClick={openHistory}
            style={{ background: "none", border: "none", fontSize: "0.58rem", letterSpacing: "0.18em", color: histOpen ? "var(--ion)" : "var(--inscription)", cursor: "pointer", padding: 0 }}
          >
            HISTORY ▸
          </button>
          <a href="/status" className="mono" style={{ fontSize: "0.58rem", letterSpacing: "0.18em", color: "var(--marble-shadow)", textDecoration: "none" }}>
            TOOLS &amp; STATUS →
          </a>
        </div>
        <ConnectButton />
      </header>

      {!isConnected ? (
        <div style={{ flex: 1, display: "grid", placeItems: "center", padding: "2rem 0" }}>
          <div className="carved" style={{ maxWidth: 460, width: "100%", padding: "2.4rem 2rem", textAlign: "center", position: "relative" }}>
            <span aria-hidden style={{ position: "absolute", insetInline: 0, top: 0, height: 1, background: "linear-gradient(90deg,transparent,var(--ion) 50%,transparent)" }} />
            <p className="mono" style={{ fontSize: "0.55rem", letterSpacing: "0.4em", color: "var(--inscription)", textTransform: "uppercase", margin: 0 }}>
              Leonardo · Private Beta
            </p>
            <h1 className="display marble-leaf" style={{ fontSize: "1.6rem", margin: "16px 0 0", lineHeight: 1.1 }}>
              Connect your wallet to enter the studio.
            </h1>
            <p style={{ color: "var(--marble-shadow)", fontSize: "0.92rem", lineHeight: 1.6, margin: "12px 0 0" }}>
              Your wallet is your identity here — it unlocks your histories and your saved conversations.
            </p>
            <div style={{ display: "flex", justifyContent: "center", marginTop: 22 }}>
              <ConnectButton />
            </div>
          </div>
        </div>
      ) : (
        <>
      {/* thread */}
      <div ref={threadRef} aria-live="polite" style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch", padding: "1.2rem 0 0.5rem", display: "flex", flexDirection: "column", gap: 10 }}>
        {items.length === 0 && (
          <div style={{ margin: "auto 0", textAlign: "center", padding: "2rem 0" }}>
            <p className="mono" style={{ fontSize: "0.55rem", letterSpacing: "0.4em", color: "var(--inscription)", textTransform: "uppercase", margin: "0 0 10px" }}>
              Leonardo · Beta 0.1
            </p>
            <h1 className="display marble-leaf" style={{ fontSize: "clamp(1.6rem, 5vw, 2.6rem)", margin: 0, lineHeight: 1.1 }}>
              I am Leonardo.
            </h1>
            <p style={{ color: "var(--marble-shadow)", maxWidth: "52ch", margin: "16px auto 0", fontSize: "0.95rem", lineHeight: 1.65 }}>
              The first concepts we&apos;re researching — through the imagination graph and the Council. Pick one to dig into:
            </p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 18 }}>
              {CHIPS.map((c) => (
                <button key={c} className="chip" onClick={() => send(c)} disabled={busy}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {items.map((it, i) => {
          if (it.kind === "user") {
            return (
              <div key={i} className="msg" style={{ alignSelf: "flex-end", maxWidth: "84%", background: "rgba(111,182,255,0.08)", border: "1px solid rgba(111,182,255,0.25)", borderRadius: 14, padding: "0.7rem 1rem", color: "var(--marble)", fontSize: "0.92rem", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                {it.text}
              </div>
            );
          }
          if (it.kind === "leo") {
            return (
              <div key={i} className="msg" style={{ alignSelf: "flex-start", maxWidth: "94%", color: "var(--marble)", fontSize: "0.95rem", lineHeight: 1.65, whiteSpace: "pre-wrap", borderLeft: "2px solid rgba(212,194,154,0.3)", paddingLeft: 14 }}>
                {it.text}
              </div>
            );
          }
          if (it.kind === "graph") return <GraphCard key={i} query={it.query} hits={it.hits} />;
          if (it.kind === "council") return <CouncilCard key={i} verdicts={it.verdicts} synthesis={it.synthesis} />;
          if (it.kind === "workshop") return <WorkshopCard key={i} brief={it.brief} />;
          if (it.kind === "notice") {
            return (
              <p key={i} style={{ color: "var(--marble-shadow)", fontSize: "0.84rem", fontStyle: "italic", margin: "2px 0" }}>{it.text}</p>
            );
          }
          if (it.kind === "error") {
            return (
              <p key={i} style={{ color: "var(--cinnabar)", fontSize: "0.84rem", margin: "2px 0" }}>{it.text}</p>
            );
          }
          // confirm card
          const c = it.confirm;
          const label = c.action === "council_panel" ? "Full council · 5 critics" : "Quick review · 1 critic";
          return (
            <div key={i} className="carved msg" style={{ padding: "1rem 1.2rem", margin: "6px 0", borderColor: "rgba(111,182,255,0.3)" }}>
              <div className="mono" style={{ fontSize: "0.52rem", letterSpacing: "0.22em", color: "var(--ion)", textTransform: "uppercase" }}>
                Paid action · {c.price} USDC · Base Sepolia
              </div>
              <p style={{ color: "var(--marble)", fontSize: "0.9rem", margin: "8px 0 2px" }}>{label}</p>
              <p style={{ color: "var(--marble-shadow)", fontSize: "0.82rem", margin: "4px 0 0", lineHeight: 1.5 }}>
                “{c.args.idea.slice(0, 180)}{c.args.idea.length > 180 ? "…" : ""}”
              </p>
              {c.state === "pending" && (
                <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                  <button
                    className="display"
                    onClick={() => approveConfirm(c)}
                    disabled={!walletClient}
                    title={walletClient ? "" : "Connect a wallet first"}
                    style={{ border: "1px solid var(--ion)", background: "rgba(111,182,255,0.14)", color: "var(--ion)", borderRadius: 9999, padding: "0.65rem 1.2rem", fontSize: "0.62rem", letterSpacing: "0.16em", textTransform: "uppercase", cursor: walletClient ? "pointer" : "not-allowed", minHeight: 44, opacity: walletClient ? 1 : 0.5 }}
                  >
                    Pay {c.price} & convene
                  </button>
                  <button
                    className="display"
                    onClick={() => declineConfirm(c)}
                    style={{ border: "1px solid var(--marble-deep)", background: "transparent", color: "var(--marble-shadow)", borderRadius: 9999, padding: "0.65rem 1.1rem", fontSize: "0.62rem", letterSpacing: "0.16em", textTransform: "uppercase", cursor: "pointer", minHeight: 44 }}
                  >
                    Decline
                  </button>
                </div>
              )}
              {c.state === "running" && (
                <p style={{ color: "var(--inscription)", fontSize: "0.82rem", marginTop: 12 }}>
                  The Council deliberates… {c.action === "council_panel" ? "(~2–3 min)" : "(~1–2 min)"}
                </p>
              )}
              {c.state === "declined" && <p style={{ color: "var(--marble-deep)", fontSize: "0.8rem", marginTop: 10 }}>Declined — nothing was charged.</p>}
              {c.state === "failed" && <p style={{ color: "var(--cinnabar)", fontSize: "0.82rem", marginTop: 10 }}>{c.error}</p>}
            </div>
          );
        })}

        {busy && (
          <div style={{ alignSelf: "flex-start", paddingLeft: 14 }}>
            <span className="typing-dots" aria-label="Leonardo is thinking"><span /><span /><span /></span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* history panel: browse + select entries as context for the next prompt */}
      {histOpen && (
        <aside
          aria-label="Activity history"
          style={{ position: "fixed", right: 0, top: 0, height: "100dvh", width: "min(340px, 88vw)", zIndex: 70, background: "var(--abyss)", borderLeft: "1px solid var(--marble-deep)", boxShadow: "-12px 0 44px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.1rem 0.6rem" }}>
            <span className="display" style={{ fontSize: "0.7rem", letterSpacing: "0.26em", color: "var(--inscription)" }}>HISTORY</span>
            <button onClick={() => setHistOpen(false)} aria-label="Close history" style={{ border: "none", background: "transparent", color: "var(--marble-shadow)", fontSize: "1rem", cursor: "pointer" }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 1.1rem 10px" }}>
            {["", "chat", "graph", "council", "workshop", "agent", "trust", "passport"].map((k) => (
              <button
                key={k || "all"}
                onClick={() => setHistFilter(k)}
                className="mono"
                style={{ border: `1px solid ${histFilter === k ? "var(--ion)" : "rgba(168,159,140,0.3)"}`, background: histFilter === k ? "rgba(111,182,255,0.1)" : "transparent", color: histFilter === k ? "var(--ion)" : "var(--marble-shadow)", borderRadius: 9999, padding: "3px 10px", fontSize: "0.55rem", letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer" }}
              >
                {k || "all"}
              </button>
            ))}
          </div>
          <p style={{ color: "var(--marble-deep)", fontSize: "0.68rem", padding: "0 1.1rem 8px", margin: 0, lineHeight: 1.45 }}>
            Tick entries to attach them as context to your next message (max 5).
          </p>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 1.1rem 1rem", display: "grid", gap: 8, alignContent: "start" }}>
            {histEntries === null && <p style={{ color: "var(--marble-deep)", fontSize: "0.78rem" }}>Loading…</p>}
            {histEntries !== null && histEntries.filter((e) => !histFilter || e.kind === histFilter).length === 0 && (
              <p style={{ color: "var(--marble-deep)", fontSize: "0.78rem" }}>Nothing here yet — your activity (chat + tools) appears here.</p>
            )}
            {(histEntries ?? [])
              .filter((e) => !histFilter || e.kind === histFilter)
              .map((e) => (
                <div key={e.id} style={{ borderBottom: "1px solid rgba(168,159,140,0.1)", paddingBottom: 6 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <input
                      type="checkbox"
                      checked={selectedCtx.has(e.id)}
                      onChange={() => toggleCtx(e)}
                      aria-label="Attach as context"
                      style={{ marginTop: 4, accentColor: "#6fb6ff", cursor: "pointer" }}
                    />
                    <details style={{ flex: 1, minWidth: 0 }}>
                      <summary style={{ cursor: "pointer", color: "var(--marble)", fontSize: "0.8rem", lineHeight: 1.45 }}>
                        <span className="mono" style={{ fontSize: "0.52rem", color: "var(--ion)", marginRight: 6, textTransform: "uppercase" }}>{e.kind}</span>
                        {e.q.slice(0, 70)}{e.q.length > 70 ? "…" : ""}
                      </summary>
                      {e.a && <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.75rem", color: "var(--marble-shadow)", margin: "6px 0 0", lineHeight: 1.5 }}>{e.a}</pre>}
                    </details>
                  </div>
                </div>
              ))}
          </div>
        </aside>
      )}

      {/* composer */}
      <footer style={{ padding: "0.8rem 0 calc(1.1rem + env(safe-area-inset-bottom))", borderTop: "1px solid rgba(168,159,140,0.14)" }}>
        {selectedCtx.size > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {[...selectedCtx.values()].map((e) => (
              <button
                key={e.id}
                onClick={() => toggleCtx(e)}
                title="Click to remove"
                className="mono"
                style={{ border: "1px solid rgba(111,182,255,0.4)", background: "rgba(111,182,255,0.08)", color: "var(--ion)", borderRadius: 9999, padding: "4px 10px", fontSize: "0.6rem", cursor: "pointer", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                📎 {e.kind}: {e.q.slice(0, 28)} ✕
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          style={{ display: "flex", gap: 10, alignItems: "flex-end" }}
        >
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Message Leonardo…"
            aria-label="Message Leonardo"
            style={{ flex: 1, resize: "none", background: "var(--abyss)", color: "var(--marble)", border: "1px solid rgba(168,159,140,0.25)", borderRadius: 16, padding: "0.8rem 1rem", fontFamily: "inherit", fontSize: "0.95rem", lineHeight: 1.5, maxHeight: 140 }}
          />
          <button
            type="submit"
            className="display"
            disabled={composerDisabled || !input.trim()}
            style={{ border: "1px solid var(--ion)", background: "rgba(111,182,255,0.12)", color: "var(--ion)", borderRadius: 9999, padding: "0.8rem 1.3rem", fontSize: "0.64rem", letterSpacing: "0.18em", textTransform: "uppercase", cursor: composerDisabled || !input.trim() ? "not-allowed" : "pointer", opacity: composerDisabled || !input.trim() ? 0.5 : 1, minHeight: 44 }}
          >
            Send
          </button>
        </form>
      </footer>
        </>
      )}
    </main>
  );
}
