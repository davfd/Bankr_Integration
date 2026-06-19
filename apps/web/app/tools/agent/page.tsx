"use client";

import { useEffect, useState } from "react";
import { ToolShell } from "@/components/platform/ToolShell";
import { hostedAgent, type HostedAgentStatus } from "@/lib/agent";

export default function HostedAgentTool() {
  const [status, setStatus] = useState<HostedAgentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [spendMsg, setSpendMsg] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    hostedAgent.status().then(setStatus).catch((e) => setErr(e instanceof Error ? e.message : "Status failed."));
  }, []);

  async function provision() {
    setBusy(true);
    setErr(null);
    try {
      setStatus(await hostedAgent.provision());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Provisioning failed.");
    } finally {
      setBusy(false);
    }
  }

  async function ask() {
    if (!prompt.trim()) return;
    setBusy(true);
    setErr(null);
    setReply(null);
    try {
      const r = await hostedAgent.prompt(prompt.trim());
      setReply(r.reply);
      setTick((t) => t + 1);
      hostedAgent.status().then(setStatus).catch(() => {});
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Prompt failed.");
    } finally {
      setBusy(false);
    }
  }

  async function trySpend() {
    setBusy(true);
    setSpendMsg(null);
    try {
      const r = await hostedAgent.trySpend();
      setSpendMsg(r.blocked ? `🛡 Blocked by the integrity gate: ${r.error}` : "Unexpectedly allowed?!");
    } catch (e) {
      setSpendMsg(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolShell
      title="Hosted Agent"
      tech="Your own agent · isolated per wallet · Hermes runtime"
      blurb="An agent of your own running on our infrastructure — its workspace and memory fully separate from everyone else's. Autonomous spending is structurally blocked until the trust capabilities (0003 + 0005) ship: try it and watch the gate refuse."
      status="LIVE · BETA"
      historyKind="agent"
      tick={tick}
    >
      <div className="carved" style={{ padding: "1.5rem" }}>
        {err && <p style={{ color: "var(--cinnabar)", fontSize: "0.88rem", margin: "0 0 12px" }}>{err}</p>}
        {!status?.provisioned ? (
          <button
            className="display"
            disabled={busy}
            onClick={provision}
            style={{ border: "1px solid var(--ion)", background: "rgba(111,182,255,0.12)", color: "var(--ion)", borderRadius: 9999, padding: "0.75rem 1.5rem", fontSize: "0.64rem", letterSpacing: "0.16em", textTransform: "uppercase", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1, minHeight: 44 }}
          >
            {busy ? "Provisioning…" : "Provision my agent"}
          </button>
        ) : (
          <>
            <p className="mono" style={{ fontSize: "0.64rem", letterSpacing: "0.12em", color: "var(--marble-deep)", margin: 0 }}>
              PROVISIONED {status.createdAt ? `· ${new Date(status.createdAt).toLocaleDateString()}` : ""} · {status.prompts ?? 0} PROMPTS
            </p>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="Ask your agent anything…"
              aria-label="Prompt your agent"
              style={{ width: "100%", marginTop: 14, background: "var(--obsidian)", color: "var(--marble)", border: "1px solid rgba(168,159,140,0.25)", borderRadius: 12, padding: "0.85rem 1rem", fontFamily: "inherit", fontSize: "0.95rem", resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button
                className="display"
                disabled={busy || !prompt.trim()}
                onClick={ask}
                style={{ border: "1px solid var(--ion)", background: "rgba(111,182,255,0.1)", color: "var(--ion)", borderRadius: 9999, padding: "0.7rem 1.3rem", fontSize: "0.64rem", letterSpacing: "0.16em", textTransform: "uppercase", cursor: busy || !prompt.trim() ? "not-allowed" : "pointer", opacity: busy || !prompt.trim() ? 0.55 : 1, minHeight: 44 }}
              >
                {busy ? "Thinking… (~30s)" : "Ask my agent"}
              </button>
              <button
                className="display"
                disabled={busy}
                onClick={trySpend}
                title="Demonstrates the integrity gate"
                style={{ border: "1px solid var(--bronze)", background: "rgba(185,138,80,0.08)", color: "var(--bronze)", borderRadius: 9999, padding: "0.7rem 1.2rem", fontSize: "0.64rem", letterSpacing: "0.16em", textTransform: "uppercase", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1, minHeight: 44 }}
              >
                Try autonomous spend
              </button>
            </div>
            {reply && (
              <pre className="msg" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.92rem", color: "var(--marble)", marginTop: 16, lineHeight: 1.6, borderTop: "1px solid rgba(168,159,140,0.2)", paddingTop: 14 }}>{reply}</pre>
            )}
            {spendMsg && <p style={{ color: "var(--bronze)", fontSize: "0.86rem", marginTop: 14, lineHeight: 1.55 }}>{spendMsg}</p>}
          </>
        )}
      </div>
    </ToolShell>
  );
}
