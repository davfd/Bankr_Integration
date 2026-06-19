"use client";

import { useMemo, useState } from "react";
import { useWalletClient } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { wrapFetchWithPayment } from "x402-fetch";
import { ToolShell } from "@/components/platform/ToolShell";
import {
  requestCouncilAudit,
  requestCouncilPlan,
  reviewIdea,
  reviewPanel,
  type CouncilPanelResult,
  type CouncilVerdict,
  type IntakeRequest,
} from "@/lib/gateway";

export default function CouncilTool() {
  const { data: walletClient } = useWalletClient({ chainId: baseSepolia.id });
  const payFetch = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return walletClient ? (wrapFetchWithPayment(fetch, walletClient as any) as unknown as typeof fetch) : undefined;
  }, [walletClient]);

  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<CouncilVerdict | null>(null);
  const [panel, setPanel] = useState<CouncilPanelResult | null>(null);
  const [intakeRequest, setIntakeRequest] = useState<IntakeRequest | null>(null);
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  async function run(mode: "single" | "panel") {
    setBusy(true);
    setErr(null);
    setVerdict(null);
    setPanel(null);
    try {
      if (mode === "panel") setPanel(await reviewPanel(idea.trim(), { fetchImpl: payFetch }));
      else setVerdict(await reviewIdea(idea.trim(), { fetchImpl: payFetch }));
      setTick((t) => t + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Review failed.");
    } finally {
      setBusy(false);
    }
  }

  async function queueIntake(kind: "plan" | "audit") {
    const brief = idea.trim();
    if (!brief) return;
    setIntakeBusy(true);
    setErr(null);
    setIntakeRequest(null);
    try {
      const input = { title: kind === "plan" ? "Council plan intake" : "Council audit intake", brief };
      setIntakeRequest(kind === "plan" ? await requestCouncilPlan(input, { fetchImpl: payFetch }) : await requestCouncilAudit(input, { fetchImpl: payFetch }));
      setTick((t) => t + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Intake failed.");
    } finally {
      setIntakeBusy(false);
    }
  }

  const btn = (primary: boolean) =>
    ({
      border: `1px solid ${primary ? "var(--ion)" : "var(--marble-deep)"}`,
      background: primary ? "rgba(111,182,255,0.12)" : "transparent",
      color: primary ? "var(--ion)" : "var(--marble-shadow)",
      borderRadius: 9999,
      padding: "0.7rem 1.3rem",
      fontSize: "0.62rem",
      letterSpacing: "0.15em",
      textTransform: "uppercase",
      cursor: busy || intakeBusy || !idea.trim() ? "not-allowed" : "pointer",
      opacity: busy || intakeBusy || !idea.trim() ? 0.55 : 1,
      minHeight: 44,
    }) as const;

  return (
    <ToolShell
      title="Council Review"
      tech="Five-seat adversarial AI review · pay-per-use"
      blurb="Put an idea before the Council. Five expert critics pick it apart, and a synthesis returns one ruling — ACCEPT / REVISE / REJECT. Paid in test USDC from your connected wallet."
      status="LIVE · BETA"
      historyKind="council"
      tick={tick}
    >
      <div className="carved" style={{ padding: "1.5rem" }}>
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          rows={5}
          placeholder="e.g. Bind an agent's authority to a revocable name, not its key, with an audit trail…"
          aria-label="Idea to review"
          style={{ width: "100%", background: "var(--obsidian)", color: "var(--marble)", border: "1px solid rgba(168,159,140,0.25)", borderRadius: 12, padding: "0.85rem 1rem", fontFamily: "inherit", fontSize: "0.95rem", resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <button className="display" disabled={busy || intakeBusy || !idea.trim()} onClick={() => run("panel")} style={btn(true)}>
            {busy ? "Deliberating… (~2 min)" : "Full council · 5 critics · $0.25"}
          </button>
          <button className="display" disabled={busy || intakeBusy || !idea.trim()} onClick={() => run("single")} style={btn(false)}>
            Quick · 1 critic · $0.05
          </button>
        </div>
        <div style={{ marginTop: 16, borderTop: "1px solid rgba(168,159,140,0.16)", paddingTop: 14 }}>
          <p style={{ color: "var(--marble-shadow)", fontSize: "0.84rem", lineHeight: 1.55, margin: "0 0 10px" }}>
            Full-system intake: Queue Council plan intake or Queue Council audit intake, then keep the receipt hash as the queue witness. Payment buys intake and queue access only; it does not buy verdict, truth, pass, safety clearance, Scripture interpretation, agent authority, or reputation.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="display" disabled={busy || intakeBusy || !idea.trim()} onClick={() => queueIntake("plan")} style={btn(false)}>
              {intakeBusy ? "Queueing…" : "Queue Council plan intake"}
            </button>
            <button className="display" disabled={busy || intakeBusy || !idea.trim()} onClick={() => queueIntake("audit")} style={btn(false)}>
              Queue Council audit intake
            </button>
          </div>
        </div>
        {!walletClient && (
          <p className="mono" style={{ color: "var(--marble-deep)", fontSize: "0.62rem", letterSpacing: "0.12em", marginTop: 12 }}>
            CONNECT A BASE SEPOLIA WALLET WITH TEST USDC TO PAY
          </p>
        )}
        {err && <p style={{ color: "var(--cinnabar)", marginTop: 14, fontSize: "0.88rem" }}>{err}</p>}
        {intakeRequest && (
          <div className="msg" style={{ marginTop: 18, borderTop: "1px solid rgba(168,159,140,0.2)", paddingTop: 14 }}>
            <div className="mono" style={{ fontSize: "0.58rem", letterSpacing: "0.18em", color: "var(--ion)", textTransform: "uppercase" }}>Queued · receipt hash</div>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit", fontSize: "0.84rem", color: "var(--marble-shadow)", margin: "10px 0 0", lineHeight: 1.55 }}>{JSON.stringify({ id: intakeRequest.id, kind: intakeRequest.kind, receipt_sha256: intakeRequest.receipt_sha256, boundary: intakeRequest.receipt.boundary }, null, 2)}</pre>
          </div>
        )}
        {panel && (
          <div className="msg" style={{ marginTop: 18, borderTop: "1px solid rgba(168,159,140,0.2)", paddingTop: 14 }}>
            <div className="mono" style={{ fontSize: "0.58rem", letterSpacing: "0.18em", color: "var(--ion)", textTransform: "uppercase" }}>The ruling</div>
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.94rem", color: "var(--marble)", margin: "10px 0 0", lineHeight: 1.6 }}>{panel.synthesis}</pre>
            <div className="mono" style={{ fontSize: "0.54rem", letterSpacing: "0.18em", color: "var(--marble-deep)", textTransform: "uppercase", margin: "18px 0 0" }}>The five seats</div>
            {panel.verdicts.map((v) => (
              <details key={v.seat} style={{ marginTop: 10 }}>
                <summary className="mono" style={{ fontSize: "0.64rem", letterSpacing: "0.12em", color: "var(--inscription)", textTransform: "capitalize", cursor: "pointer" }}>{v.seat}</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.84rem", color: "var(--marble-shadow)", margin: "6px 0 0", lineHeight: 1.55 }}>{v.verdict}</pre>
              </details>
            ))}
          </div>
        )}
        {verdict && (
          <div className="msg" style={{ marginTop: 18, borderTop: "1px solid rgba(168,159,140,0.2)", paddingTop: 14 }}>
            <div className="mono" style={{ fontSize: "0.58rem", letterSpacing: "0.18em", color: "var(--inscription)", textTransform: "uppercase" }}>
              {verdict.seat} · {Math.round(verdict.ms / 1000)}s
            </div>
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.92rem", color: "var(--marble)", margin: "10px 0 0", lineHeight: 1.6 }}>{verdict.verdict}</pre>
          </div>
        )}
      </div>
    </ToolShell>
  );
}
