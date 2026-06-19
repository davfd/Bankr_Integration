"use client";

import { useMemo, useState } from "react";
import { useWalletClient } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { wrapFetchWithPayment } from "x402-fetch";
import { ToolShell } from "@/components/platform/ToolShell";
import { requestWorkshopIntake, researchTopic, type IntakeRequest, type WorkshopBriefCompact } from "@/lib/gateway";

export default function WorkshopTool() {
  const { data: walletClient } = useWalletClient({ chainId: baseSepolia.id });
  const payFetch = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return walletClient ? (wrapFetchWithPayment(fetch, walletClient as any) as unknown as typeof fetch) : undefined;
  }, [walletClient]);
  const [topic, setTopic] = useState("");
  const [brief, setBrief] = useState<WorkshopBriefCompact | null>(null);
  const [intakeRequest, setIntakeRequest] = useState<IntakeRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  async function run() {
    if (topic.trim().length < 3) return;
    setBusy(true);
    setErr(null);
    setBrief(null);
    try {
      setBrief(await researchTopic(topic.trim()));
      setTick((t) => t + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Research failed.");
    } finally {
      setBusy(false);
    }
  }

  async function queueIntake(kind: "brief" | "reproduction" | "build") {
    const title = topic.trim();
    if (title.length < 3) return;
    setIntakeBusy(true);
    setErr(null);
    setIntakeRequest(null);
    try {
      setIntakeRequest(await requestWorkshopIntake({ kind, title, brief: title }, { fetchImpl: payFetch }));
      setTick((t) => t + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Workshop intake failed.");
    } finally {
      setIntakeBusy(false);
    }
  }

  return (
    <ToolShell
      title="Workshop"
      tech="Research briefs · graph + Bible + modern analogues"
      blurb="Give it a concept and the Workshop researches a brief: where the idea comes from, its Bible parallels, the closest modern technology, and the top risk. Free in beta."
      status="LIVE · BETA"
      historyKind="workshop"
      tick={tick}
    >
      <div className="carved" style={{ padding: "1.5rem" }}>
        <form onSubmit={(e) => { e.preventDefault(); run(); }} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. true name, golem, memory palace…"
            aria-label="Topic to research"
            style={{ flex: "1 1 260px", background: "var(--obsidian)", color: "var(--marble)", border: "1px solid rgba(168,159,140,0.25)", borderRadius: 9999, padding: "0.75rem 1.1rem", fontFamily: "inherit", fontSize: "0.95rem" }}
          />
          <button
            type="submit"
            className="display"
            disabled={busy || intakeBusy || topic.trim().length < 3}
            style={{ border: "1px solid var(--bronze)", background: "rgba(185,138,80,0.1)", color: "var(--bronze)", borderRadius: 9999, padding: "0.75rem 1.5rem", fontSize: "0.64rem", letterSpacing: "0.16em", textTransform: "uppercase", cursor: busy || intakeBusy ? "not-allowed" : "pointer", opacity: busy || intakeBusy || topic.trim().length < 3 ? 0.6 : 1, minHeight: 44 }}
          >
            {busy ? "Researching…" : "Research"}
          </button>
        </form>
        <div style={{ marginTop: 16, borderTop: "1px solid rgba(168,159,140,0.16)", paddingTop: 14 }}>
          <p style={{ color: "var(--marble-shadow)", fontSize: "0.84rem", lineHeight: 1.55, margin: "0 0 10px" }}>
            Full-system intake: Queue Workshop brief intake, Queue reproduction intake, or Queue build intake, then keep the receipt hash as the queue witness. Payment buys Workshop intake and queue access only; it does not buy result, implementation success, safety clearance, acceptance, Scripture interpretation, agent authority, or reputation.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {(["brief", "reproduction", "build"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className="display"
                disabled={busy || intakeBusy || topic.trim().length < 3}
                onClick={() => queueIntake(kind)}
                style={{ border: "1px solid var(--marble-deep)", background: "transparent", color: "var(--marble-shadow)", borderRadius: 9999, padding: "0.65rem 1.1rem", fontSize: "0.58rem", letterSpacing: "0.14em", textTransform: "uppercase", cursor: busy || intakeBusy ? "not-allowed" : "pointer", opacity: busy || intakeBusy || topic.trim().length < 3 ? 0.6 : 1, minHeight: 42 }}
              >
                {kind === "brief" ? "Queue Workshop brief intake" : kind === "reproduction" ? "Queue reproduction intake" : "Queue build intake"}
              </button>
            ))}
          </div>
        </div>
        {err && <p style={{ color: "var(--cinnabar)", marginTop: 14, fontSize: "0.88rem" }}>{err}</p>}
        {intakeRequest && (
          <div className="msg" style={{ marginTop: 18, borderTop: "1px solid rgba(168,159,140,0.2)", paddingTop: 16 }}>
            <div className="mono" style={{ fontSize: "0.54rem", letterSpacing: "0.22em", color: "var(--bronze)", textTransform: "uppercase" }}>Queued · receipt hash</div>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit", fontSize: "0.84rem", color: "var(--marble-shadow)", margin: "10px 0 0", lineHeight: 1.55 }}>{JSON.stringify({ id: intakeRequest.id, kind: intakeRequest.kind, receipt_sha256: intakeRequest.receipt_sha256, boundary: intakeRequest.receipt.boundary }, null, 2)}</pre>
          </div>
        )}
        {brief && (
          <div className="msg" style={{ marginTop: 18, borderTop: "1px solid rgba(168,159,140,0.2)", paddingTop: 16 }}>
            {brief.note ? (
              <p style={{ color: "var(--marble-shadow)" }}>{brief.note}</p>
            ) : (
              <>
                <div className="mono" style={{ fontSize: "0.54rem", letterSpacing: "0.22em", color: "var(--bronze)", textTransform: "uppercase" }}>
                  Brief · {brief.concept}
                </div>
                {brief.what_it_is && <p style={{ color: "var(--marble)", fontSize: "0.95rem", lineHeight: 1.6, margin: "10px 0 0" }}>{brief.what_it_is}</p>}
                {brief.modern_analogue && (
                  <p style={{ color: "var(--marble-shadow)", fontSize: "0.88rem", margin: "12px 0 0", lineHeight: 1.55 }}>
                    <span style={{ color: "var(--inscription)" }}>Modern analogue · </span>{brief.modern_analogue}
                  </p>
                )}
                {brief.bible_parallel && (
                  <p style={{ color: "var(--marble-shadow)", fontSize: "0.88rem", margin: "8px 0 0" }}>
                    <span style={{ color: "var(--inscription)" }}>Bible parallel · </span>{brief.bible_parallel}
                  </p>
                )}
                {brief.risk && (
                  <p style={{ color: "var(--marble-shadow)", fontSize: "0.88rem", margin: "8px 0 0", lineHeight: 1.55 }}>
                    <span style={{ color: "var(--bronze)" }}>Top risk · </span>{brief.risk}
                  </p>
                )}
                {brief.counts && (
                  <p className="mono" style={{ fontSize: "0.62rem", letterSpacing: "0.1em", color: "var(--marble-deep)", margin: "14px 0 0" }}>
                    {brief.counts.mentions ?? 0} MENTIONS · {brief.counts.co_occurrences ?? 0} CO-OCCURRING · {brief.counts.bible_parallels ?? 0} BIBLE PARALLELS
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <p style={{ color: "var(--marble-deep)", fontSize: "0.78rem", marginTop: 12 }}>
        Tip: Leonardo can run this for you in <a href="/" style={{ color: "var(--ion)" }}>the chat</a> — those briefs land in the same history.
      </p>
    </ToolShell>
  );
}
