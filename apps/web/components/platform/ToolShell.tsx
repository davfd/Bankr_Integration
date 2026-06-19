"use client";

// Full-page shell for every platform function: glass header (back links +
// wallet), a wide work area, and a permanent per-surface history rail.
import { useEffect, useState, type ReactNode } from "react";
import { ConnectButton } from "./ConnectButton";
import { history, type HistoryEntry } from "@/lib/history";
import { TOOLS_COMING_SOON } from "./flags";

export function HistoryRail({ kind, tick }: { kind: string; tick: number }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    history.list(kind).then(setEntries).catch(() => setEntries([]));
  }, [kind, tick, reload]);
  return (
    <aside className="carved" style={{ padding: "1.2rem 1.3rem", alignSelf: "start", position: "sticky", top: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="mono" style={{ fontSize: "0.54rem", letterSpacing: "0.24em", color: "var(--inscription)", textTransform: "uppercase" }}>
          History{entries ? ` · ${entries.length}` : ""}
        </span>
        <button
          onClick={() => setReload((r) => r + 1)}
          aria-label="Refresh history"
          className="mono"
          style={{ border: "none", background: "transparent", color: "var(--marble-deep)", fontSize: "0.72rem", cursor: "pointer" }}
        >
          ↻
        </button>
      </div>
      <p style={{ color: "var(--marble-deep)", fontSize: "0.7rem", margin: "8px 0 0", lineHeight: 1.5 }}>
        Everything you (or Leonardo in chat) did here — queries and answers.
      </p>
      <div style={{ display: "grid", gap: 8, marginTop: 12, maxHeight: "58vh", overflowY: "auto" }}>
        {entries === null && <p style={{ color: "var(--marble-deep)", fontSize: "0.78rem" }}>Loading…</p>}
        {entries !== null && entries.length === 0 && (
          <p style={{ color: "var(--marble-deep)", fontSize: "0.78rem" }}>Nothing yet.</p>
        )}
        {(entries ?? []).map((e) => (
          <details key={e.id} style={{ borderBottom: "1px solid rgba(168,159,140,0.1)", paddingBottom: 6 }}>
            <summary style={{ cursor: "pointer", color: "var(--marble)", fontSize: "0.8rem", lineHeight: 1.45 }}>
              <span className="mono" style={{ fontSize: "0.52rem", color: "var(--marble-deep)", marginRight: 8 }}>
                {new Date(e.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
              {e.q.slice(0, 80)}{e.q.length > 80 ? "…" : ""}
            </summary>
            {e.a && (
              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.76rem", color: "var(--marble-shadow)", margin: "6px 0 0", lineHeight: 1.5 }}>{e.a}</pre>
            )}
          </details>
        ))}
      </div>
    </aside>
  );
}

function ComingSoonPanel() {
  return (
    <div className="carved" style={{ padding: "2.4rem 2rem", textAlign: "center" }}>
      <span className="mono" style={{ border: "1px solid var(--bronze)", color: "var(--bronze)", borderRadius: 9999, padding: "4px 14px", fontSize: "0.56rem", letterSpacing: "0.24em" }}>
        COMING SOON
      </span>
      <h2 className="display marble-leaf" style={{ fontSize: "clamp(1.3rem, 3vw, 1.9rem)", margin: "18px 0 0", lineHeight: 1.15 }}>
        This bench is being fitted.
      </h2>
      <p style={{ color: "var(--marble-shadow)", maxWidth: "46ch", margin: "12px auto 0", fontSize: "0.95rem", lineHeight: 1.6 }}>
        The direct workspace opens soon. Leonardo can already do this for you in the chat — and everything he does lands in your history on the right.
      </p>
      <a
        href="/"
        className="display"
        style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 20, border: "1px solid var(--ion)", background: "rgba(111,182,255,0.1)", color: "var(--ion)", borderRadius: 9999, padding: "0.75rem 1.5rem", fontSize: "0.64rem", letterSpacing: "0.18em", textTransform: "uppercase", minHeight: 44 }}
      >
        Ask Leonardo →
      </a>
    </div>
  );
}

export function ToolShell(props: {
  title: string;
  tech: string;
  blurb: string;
  status?: string; // e.g. "LIVE · BETA"
  historyKind: string;
  tick: number;
  /** Informational pages stay visible even under the coming-soon posture. */
  live?: boolean;
  children: ReactNode;
}) {
  const gated = TOOLS_COMING_SOON && !props.live;
  return (
    <main style={{ position: "relative", zIndex: 2, maxWidth: 1200, margin: "0 auto", padding: "0 1.2rem 4rem" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "1.1rem 0", borderBottom: "1px solid rgba(168,159,140,0.14)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <a href="/" className="display gold-leaf" style={{ fontSize: "0.95rem", letterSpacing: "0.3em" }}>LEONARDO</a>
          <a href="/status" className="mono" style={{ fontSize: "0.56rem", letterSpacing: "0.18em", color: "var(--marble-shadow)" }}>← ALL TOOLS</a>
        </div>
        <ConnectButton />
      </header>

      <section style={{ padding: "2.2rem 0 1.6rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 className="display marble-leaf" style={{ fontSize: "clamp(1.7rem, 4.5vw, 2.7rem)", margin: 0, lineHeight: 1.05 }}>{props.title}</h1>
          {(gated || props.status) && (
            <span className="mono" style={{ border: `1px solid ${gated ? "var(--bronze)" : "rgba(111,182,255,0.4)"}`, color: gated ? "var(--bronze)" : "var(--ion)", borderRadius: 9999, padding: "3px 11px", fontSize: "0.55rem", letterSpacing: "0.18em" }}>
              {gated ? "COMING SOON · HISTORY LIVE" : props.status}
            </span>
          )}
        </div>
        <div className="mono" style={{ fontSize: "0.56rem", letterSpacing: "0.18em", color: "var(--marble-deep)", textTransform: "uppercase", marginTop: 8 }}>{props.tech}</div>
        <p style={{ color: "var(--marble-shadow)", maxWidth: "62ch", marginTop: 12, fontSize: "0.95rem", lineHeight: 1.6 }}>{props.blurb}</p>
      </section>

      <div style={{ display: "grid", gap: "1.2rem", gridTemplateColumns: "minmax(0, 1fr)", alignItems: "start" }} className="tool-grid">
        <div style={{ minWidth: 0 }}>{gated ? <ComingSoonPanel /> : props.children}</div>
        <HistoryRail kind={props.historyKind} tick={props.tick} />
      </div>
      <style>{`@media (min-width: 980px) { .tool-grid { grid-template-columns: minmax(0, 1fr) 360px !important; } }`}</style>
    </main>
  );
}
