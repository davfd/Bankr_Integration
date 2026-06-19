"use client";

import { useState } from "react";
import { useAccount, useWalletClient, useSwitchChain } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { ToolShell } from "@/components/platform/ToolShell";
import { registerAgentFromWallet, listMyAgents, type RegisterResult } from "@/lib/erc8004";
import { setActiveAgentPassportId } from "@/lib/passport-selection";
import { history } from "@/lib/history";

export default function PassportTool() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient({ chainId: baseSepolia.id });
  const { switchChainAsync } = useSwitchChain();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [mine, setMine] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  async function loadMine() {
    if (address) listMyAgents(address).then(setMine).catch(() => {});
  }

  async function mint() {
    if (!walletClient || !address) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      await switchChainAsync({ chainId: baseSepolia.id });
      const r = await registerAgentFromWallet(walletClient);
      if (r.agentId) setActiveAgentPassportId(r.agentId);
      setResult(r);
      history.add("passport", "Minted Agent Passport", `#${r.agentId ?? "?"} · ${r.txHash}`).finally(() => setTick((t) => t + 1));
      loadMine();
    } catch (e) {
      const m = e instanceof Error ? e.message : "Mint failed.";
      setErr(/insufficient|gas|fund/i.test(m) ? "Mint failed — your wallet needs a little Base Sepolia ETH for gas." : m.slice(0, 160));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolShell
      title="Agent Passport"
      tech="Permanent on-chain agent ID · ERC-8004 · Base Sepolia"
      blurb="Mint a permanent identity token for your agent, straight from your wallet. You pay only the tiny network gas; the ID is verifiable by anyone on Basescan."
      status="LIVE"
      historyKind="passport"
      tick={tick}
    >
      <div className="carved" style={{ padding: "1.5rem" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            className="display"
            disabled={busy || !walletClient}
            onClick={mint}
            title={walletClient ? "" : "Connect a wallet first"}
            style={{ border: "1px solid var(--ion)", background: "rgba(111,182,255,0.12)", color: "var(--ion)", borderRadius: 9999, padding: "0.75rem 1.5rem", fontSize: "0.64rem", letterSpacing: "0.16em", textTransform: "uppercase", cursor: busy || !walletClient ? "not-allowed" : "pointer", opacity: busy || !walletClient ? 0.55 : 1, minHeight: 44 }}
          >
            {busy ? "Check your wallet… minting + binding" : "Mint my Agent Passport"}
          </button>
          <button
            className="display"
            onClick={loadMine}
            disabled={!address}
            style={{ border: "1px solid var(--marble-deep)", background: "transparent", color: "var(--marble-shadow)", borderRadius: 9999, padding: "0.75rem 1.2rem", fontSize: "0.64rem", letterSpacing: "0.16em", textTransform: "uppercase", cursor: address ? "pointer" : "not-allowed", minHeight: 44, opacity: address ? 1 : 0.5 }}
          >
            My passports
          </button>
        </div>
        {err && <p style={{ color: "var(--cinnabar)", marginTop: 14, fontSize: "0.88rem" }}>{err}</p>}
        {result && (
          <div className="msg" style={{ marginTop: 16, borderTop: "1px solid rgba(168,159,140,0.2)", paddingTop: 14 }}>
            <div className="mono" style={{ fontSize: "0.8rem", color: "var(--ion)" }}>✓ Minted + bound Agent Passport{result.agentId ? ` · #${result.agentId}` : ""}</div>
            <a href={`https://sepolia.basescan.org/tx/${result.txHash}`} target="_blank" rel="noopener noreferrer" className="mono" style={{ display: "inline-block", marginTop: 8, fontSize: "0.7rem", color: "var(--marble-shadow)" }}>
              view mint transaction on Basescan ↗
            </a>
            {result.metadataTxHash && (
              <a href={`https://sepolia.basescan.org/tx/${result.metadataTxHash}`} target="_blank" rel="noopener noreferrer" className="mono" style={{ display: "inline-block", marginTop: 8, marginLeft: 12, fontSize: "0.7rem", color: "var(--marble-shadow)" }}>
                view metadata binding ↗
              </a>
            )}
            {result.agentId && <p className="mono" style={{ color: "var(--marble-shadow)", fontSize: "0.72rem", marginTop: 10 }}>Identity Kernel active passport set to #{result.agentId} in this browser.</p>}
          </div>
        )}
        {mine && (
          <div style={{ marginTop: 14 }}>
            {mine.length > 0 ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span className="mono" style={{ color: "var(--marble-shadow)", fontSize: "0.74rem" }}>This wallet holds:</span>
                {mine.map((id) => (
                  <button
                    key={id}
                    className="mono"
                    onClick={() => setActiveAgentPassportId(id)}
                    style={{ border: "1px solid rgba(111,182,255,0.35)", background: "rgba(111,182,255,0.08)", color: "var(--ion)", borderRadius: 9999, padding: "0.35rem 0.65rem", fontSize: "0.68rem", cursor: "pointer" }}
                    title="Use this passport id for Identity Kernel chat in this browser"
                  >
                    use #{id}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mono" style={{ color: "var(--marble-shadow)", fontSize: "0.74rem", margin: 0 }}>No passports found for this wallet yet (public RPC may cap old logs).</p>
            )}
          </div>
        )}
      </div>
    </ToolShell>
  );
}
