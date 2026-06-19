"use client";

import { useState } from "react";
import { useWalletClient, useSwitchChain } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { ToolShell } from "@/components/platform/ToolShell";
import { readAgentReputation, giveFeedbackFromWallet, type AgentReputation } from "@/lib/trust";
import { history } from "@/lib/history";

export default function TrustTool() {
  const { data: walletClient } = useWalletClient({ chainId: baseSepolia.id });
  const { switchChainAsync } = useSwitchChain();
  const [agentId, setAgentId] = useState("1");
  const [rep, setRep] = useState<AgentReputation | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [score, setScore] = useState(5);
  const [tx, setTx] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  async function lookup() {
    setBusy(true);
    setErr(null);
    setRep(null);
    setTx(null);
    try {
      const r = await readAgentReputation(BigInt(agentId.trim() || "0"));
      setRep(r);
      history
        .add("trust", `Looked up agent #${agentId}`, r.count > 0 ? `avg ${r.average?.toFixed(2)} · ${r.count} ratings · ${r.clients} raters` : "no ratings yet")
        .finally(() => setTick((t) => t + 1));
    } catch (e) {
      setErr(e instanceof Error ? e.message.slice(0, 140) : "Lookup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function rate() {
    if (!walletClient) return;
    setBusy(true);
    setErr(null);
    try {
      await switchChainAsync({ chainId: baseSepolia.id });
      const t = await giveFeedbackFromWallet(walletClient, { agentId: BigInt(agentId.trim() || "0"), score });
      setTx(t);
      history.add("trust", `Rated agent #${agentId}: ${score}/5`, t).finally(() => setTick((x) => x + 1));
      lookup();
    } catch (e) {
      const m = e instanceof Error ? e.message : "Rating failed.";
      setErr(/self-feedback/i.test(m) ? "You can't rate your own agent — the contract forbids it." : m.slice(0, 140));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolShell
      title="Trust Registry"
      tech="On-chain reputation · ERC-8004 · Base Sepolia"
      blurb="Look up any agent's permanent on-chain reputation and leave your own rating. The contract forbids rating your own agent — trust can't be self-issued. (Validation — third-party verification — waits on the ERC-8004 spec itself.)"
      status="LIVE · BETA"
      historyKind="trust"
      tick={tick}
    >
      <div className="carved" style={{ padding: "1.5rem" }}>
        <form onSubmit={(e) => { e.preventDefault(); lookup(); }} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={agentId}
            onChange={(e) => setAgentId(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="Agent ID, e.g. 1 or 6960"
            aria-label="Agent ID"
            style={{ flex: "1 1 180px", background: "var(--obsidian)", color: "var(--marble)", border: "1px solid rgba(168,159,140,0.25)", borderRadius: 9999, padding: "0.75rem 1.1rem", fontFamily: "inherit", fontSize: "0.95rem" }}
          />
          <button type="submit" className="display" disabled={busy || !agentId.trim()} style={{ border: "1px solid var(--ion)", background: "rgba(111,182,255,0.1)", color: "var(--ion)", borderRadius: 9999, padding: "0.75rem 1.5rem", fontSize: "0.64rem", letterSpacing: "0.16em", textTransform: "uppercase", cursor: busy ? "not-allowed" : "pointer", opacity: busy || !agentId.trim() ? 0.6 : 1, minHeight: 44 }}>
            {busy ? "Reading…" : "Look up"}
          </button>
        </form>
        {err && <p style={{ color: "var(--cinnabar)", marginTop: 14, fontSize: "0.88rem" }}>{err}</p>}
        {rep && (
          <div className="msg" style={{ marginTop: 18, borderTop: "1px solid rgba(168,159,140,0.2)", paddingTop: 16 }}>
            <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
              <div>
                <div className="mono" style={{ fontSize: "0.54rem", letterSpacing: "0.2em", color: "var(--marble-shadow)", textTransform: "uppercase" }}>Average</div>
                <div className="display gold-leaf" style={{ fontSize: "2rem" }}>{rep.average === null ? "—" : rep.average.toFixed(2)}</div>
              </div>
              <div>
                <div className="mono" style={{ fontSize: "0.54rem", letterSpacing: "0.2em", color: "var(--marble-shadow)", textTransform: "uppercase" }}>Ratings</div>
                <div className="display" style={{ fontSize: "2rem", color: "var(--marble)" }}>{rep.count}</div>
              </div>
              <div>
                <div className="mono" style={{ fontSize: "0.54rem", letterSpacing: "0.2em", color: "var(--marble-shadow)", textTransform: "uppercase" }}>Raters</div>
                <div className="display" style={{ fontSize: "2rem", color: "var(--marble)" }}>{rep.clients}</div>
              </div>
            </div>
            {rep.recent.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, margin: "14px 0 0", display: "grid", gap: 7 }}>
                {rep.recent.map((r, i) => (
                  <li key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, borderBottom: "1px solid rgba(168,159,140,0.1)", paddingBottom: 6, opacity: r.revoked ? 0.45 : 1 }}>
                    <span className="mono" style={{ fontSize: "0.7rem", color: "var(--marble-shadow)" }}>{r.client.slice(0, 8)}…{r.client.slice(-4)}{r.tag ? ` · ${r.tag}` : ""}{r.revoked ? " · revoked" : ""}</span>
                    <span className="mono" style={{ fontSize: "0.78rem", color: "var(--ion)" }}>{r.value}</span>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 18, flexWrap: "wrap" }}>
              <select value={score} onChange={(e) => setScore(Number(e.target.value))} aria-label="Score" style={{ background: "var(--obsidian)", color: "var(--marble)", border: "1px solid rgba(168,159,140,0.25)", borderRadius: 9999, padding: "0.65rem 1rem", fontFamily: "inherit", fontSize: "0.9rem" }}>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 5</option>)}
              </select>
              <button
                className="display"
                disabled={busy || !walletClient}
                onClick={rate}
                title={walletClient ? "" : "Connect a wallet first"}
                style={{ border: "1px solid var(--inscription)", background: "rgba(212,194,154,0.08)", color: "var(--inscription)", borderRadius: 9999, padding: "0.7rem 1.3rem", fontSize: "0.64rem", letterSpacing: "0.16em", textTransform: "uppercase", cursor: busy || !walletClient ? "not-allowed" : "pointer", opacity: busy || !walletClient ? 0.5 : 1, minHeight: 44 }}
              >
                {busy ? "Signing…" : "Rate this agent"}
              </button>
            </div>
            {tx && (
              <a href={`https://sepolia.basescan.org/tx/${tx}`} target="_blank" rel="noopener noreferrer" className="mono" style={{ display: "inline-block", marginTop: 10, fontSize: "0.7rem", color: "var(--ion)" }}>
                ✓ rating recorded — view on Basescan ↗
              </a>
            )}
          </div>
        )}
      </div>
    </ToolShell>
  );
}
