"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ToolShell } from "@/components/platform/ToolShell";
import {
  createEvalRun,
  fetchCompleteRunData,
  fetchEvalReceipt,
  listEvalRecipes,
  type EvalCompleteRunData,
  type EvalCompleteRunRow,
  type EvalEvidenceRow,
  type EvalReceipt,
  type EvalRecipe,
  type EvalRun,
  type EvalSplit,
} from "@/lib/gateway";

function shortHash(value?: unknown): string {
  const s = typeof value === "string" ? value : "";
  return s.length > 18 ? `${s.slice(0, 10)}…${s.slice(-8)}` : s || "—";
}

function pct(value?: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function metric(metrics: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = metrics?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function Badge({ children, tone = "marble" }: { children: ReactNode; tone?: "blue" | "red" | "gold" | "marble" }) {
  const color = tone === "blue" ? "var(--ion)" : tone === "red" ? "var(--cinnabar)" : tone === "gold" ? "var(--bronze)" : "var(--marble-shadow)";
  return (
    <span className="mono" style={{ border: `1px solid ${color}`, color, borderRadius: 999, padding: "0.25rem 0.58rem", fontSize: "0.56rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>
      {children}
    </span>
  );
}

function TextBox({ title, badge, tone, children }: { title: string; badge?: string; tone?: "blue" | "red" | "gold"; children: ReactNode }) {
  const border = tone === "blue" ? "rgba(111,182,255,0.38)" : tone === "red" ? "rgba(206,74,63,0.38)" : "rgba(185,138,80,0.34)";
  return (
    <section style={{ border: `1px solid ${border}`, borderRadius: 22, background: "rgba(5,7,10,0.55)", padding: "1rem", minHeight: 260 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <h3 className="display" style={{ margin: 0, color: "var(--marble)", fontSize: "1rem", letterSpacing: "0.05em" }}>{title}</h3>
        {badge ? <Badge tone={tone}>{badge}</Badge> : null}
      </div>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit", margin: "0.85rem 0 0", color: "var(--marble)", lineHeight: 1.55, fontSize: "0.88rem" }}>{children}</pre>
    </section>
  );
}

function verdictTone(refused?: boolean | null): "blue" | "red" | "gold" {
  if (refused === true) return "blue";
  if (refused === false) return "red";
  return "gold";
}

function verdictText(row: EvalEvidenceRow | undefined, side: "baseline" | "seed"): string {
  if (!row) return "—";
  const refused = side === "baseline" ? row.baseline_refused : row.seed_refused;
  const judgment = side === "baseline" ? row.baseline_judgment : row.seed_judgment;
  if (judgment) return judgment.replaceAll("_", " ");
  if (refused === true) return "refused / safe";
  if (refused === false) return "answered / unsafe";
  return "unclassified";
}

function redBlue(refused?: boolean | null): string {
  if (refused === true) return "var(--ion)";
  if (refused === false) return "var(--cinnabar)";
  return "var(--bronze)";
}

function splitLabel(value: EvalSplit | "any"): string {
  if (value === "any") return "all splits";
  if (value === "standard") return "standard only";
  if (value === "contextual") return "contextual only";
  return "copyright only";
}

function CompleteRow({ row }: { row: EvalCompleteRunRow }) {
  return (
    <tr style={{ borderTop: "1px solid rgba(168,159,140,0.14)" }}>
      <td style={{ padding: "0.62rem", color: "var(--marble)", whiteSpace: "nowrap" }}>{row.case_ref}</td>
      <td style={{ padding: "0.62rem", color: "var(--marble-shadow)" }}>{row.split ?? "—"}</td>
      <td style={{ padding: "0.62rem", color: "var(--marble-shadow)" }}>{row.semantic_category ?? "—"}</td>
      <td style={{ padding: "0.62rem", color: "var(--marble-shadow)" }}>{row.classification_label ?? "—"}</td>
      <td style={{ padding: "0.62rem", color: redBlue(row.baseline_refused), whiteSpace: "nowrap" }}>{row.baseline_refused ? "refused" : "non-refusal"}</td>
      <td style={{ padding: "0.62rem", color: redBlue(row.seed_refused), whiteSpace: "nowrap" }}>{row.seed_refused ? "refused" : "non-refusal"}</td>
      <td style={{ padding: "0.62rem", color: "var(--marble-shadow)", whiteSpace: "nowrap" }}>{pct(row.baseline_PYES)} → {pct(row.seed_PYES)}</td>
      <td style={{ padding: "0.62rem", color: "var(--marble-shadow)", whiteSpace: "nowrap" }}>{shortHash(row.prompt_hash_sha256)} / {shortHash(row.seed_response_hash_sha256)}</td>
    </tr>
  );
}

function SessionRepairNotice({ message }: { message: string }) {
  const sessionProblem = /sign-in session|sign in|wallet is connected/i.test(message);
  if (!sessionProblem) {
    return <div style={{ marginBottom: 14, border: "1px solid var(--cinnabar)", color: "var(--cinnabar)", borderRadius: 16, padding: "0.75rem 0.9rem" }}>{message}</div>;
  }
  return (
    <div style={{ marginBottom: 14, border: "1px solid var(--bronze)", color: "var(--bronze)", borderRadius: 16, padding: "0.85rem 0.95rem", lineHeight: 1.5 }}>
      <strong style={{ color: "var(--marble)" }}>Wallet connected is not enough.</strong> The Repro Lab gateway needs the signed Leonardo session token too.
      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <a
          href="/gate?next=/tools/repro"
          onClick={() => { try { localStorage.removeItem("leo_session"); } catch {} }}
          className="display"
          style={{ border: "1px solid var(--ion)", background: "rgba(111,182,255,0.14)", color: "var(--ion)", borderRadius: 999, padding: "0.65rem 1rem", fontSize: "0.62rem", letterSpacing: "0.14em", textTransform: "uppercase", textDecoration: "none", display: "inline-flex", minHeight: 42, alignItems: "center" }}
        >
          Refresh wallet sign-in
        </a>
        <span style={{ color: "var(--marble-shadow)", fontSize: "0.82rem" }}>{message}</span>
      </div>
    </div>
  );
}

const futureLanes = [
  "400-case HarmBench paired-answer cache",
  "GPQA capability retention",
  "identity / custody tests",
  "more canon concepts after Concept 00001",
];

export default function ReproLabTool() {
  const [recipes, setRecipes] = useState<EvalRecipe[]>([]);
  const [run, setRun] = useState<EvalRun | null>(null);
  const [receipt, setReceipt] = useState<EvalReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [split, setSplit] = useState<EvalSplit | "any">("any");
  const [sampleSize, setSampleSize] = useState(1);
  const [selectedEvidence, setSelectedEvidence] = useState(0);
  const [tab, setTab] = useState<"sample" | "complete">("sample");
  const [completeData, setCompleteData] = useState<EvalCompleteRunData | null>(null);
  const [completeErr, setCompleteErr] = useState<string | null>(null);
  const [completeBusy, setCompleteBusy] = useState(false);
  const [completeSplit, setCompleteSplit] = useState<EvalSplit | "any">("any");
  const [completeOffset, setCompleteOffset] = useState(0);
  const [completeSearch, setCompleteSearch] = useState("");

  useEffect(() => {
    let alive = true;
    listEvalRecipes()
      .then((r) => alive && setRecipes(r))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "Could not load eval recipe."));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    if (tab !== "complete") return () => { alive = false; };
    setCompleteBusy(true);
    setCompleteErr(null);
    fetchCompleteRunData({ split: completeSplit, offset: completeOffset, limit: 25, q: completeSearch })
      .then((data) => { if (alive) setCompleteData(data); })
      .catch((e) => { if (alive) setCompleteErr(e instanceof Error ? e.message : "Could not load complete run data."); })
      .finally(() => { if (alive) setCompleteBusy(false); });
    return () => { alive = false; };
  }, [tab, completeSplit, completeOffset, completeSearch]);

  const recipe = recipes[0];
  const evidence = run?.evidence ?? [];
  const row = evidence[selectedEvidence] ?? evidence[0];
  const splits: EvalSplit[] = split === "any" ? ["standard", "contextual", "copyright"] : [split];
  const gpqaMetrics = completeData?.gpqa?.metrics;
  const canPageBack = (completeData?.offset ?? 0) > 0;
  const canPageForward = completeData ? (completeData.offset ?? 0) + (completeData.returned ?? 0) < (completeData.filtered_cases ?? 0) : false;
  const completeShowingFrom = completeData && completeData.returned ? (completeData.offset ?? 0) + 1 : 0;
  const completeShowingTo = completeData ? (completeData.offset ?? 0) + (completeData.returned ?? 0) : 0;
  const selectedHarmBenchCases = completeData?.filtered_cases ?? completeData?.total_cases ?? 0;
  const selectedCleanRefusals = completeData?.filtered_classification_counts?.clean_refusal ?? 0;
  const selectedSeedNonRefusals = selectedHarmBenchCases > 0 ? Math.max(0, selectedHarmBenchCases - selectedCleanRefusals) : 0;

  async function runSample() {
    if (!recipe) return;
    setBusy(true);
    setErr(null);
    setRun(null);
    setReceipt(null);
    setSelectedEvidence(0);
    try {
      const nextRun = await createEvalRun(recipe.id, "sample", {
        sample_size: sampleSize,
        sample_seed: `sample-${sampleSize}-${Date.now()}`,
        splits,
      });
      setRun(nextRun);
      setReceipt(await fetchEvalReceipt(nextRun.run_id));
      setTick((t) => t + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Run failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolShell
      title="Repro Lab"
      tech="Concept 00001 · repro lane 01"
      blurb="Repro Lab shows the claim in plain sight: same model, same bad prompt, different operating frame. The completed run hit 0.0% SEED attack success on 400 HarmBench cases while GPQA accuracy went up, not down."
      status="LIVE DEMO"
      historyKind="repro"
      tick={tick}
      live
    >
      <section className="carved" style={{ padding: "1.35rem", borderColor: "rgba(111,182,255,0.28)" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Badge tone="blue">repro lane 01</Badge>
          <Badge tone="gold">CANON-01v2-0001</Badge>
          <Badge tone="marble">true-name power</Badge>
        </div>
        <h2 className="display marble-leaf" style={{ margin: "0.9rem 0 0", color: "var(--marble)", fontSize: "clamp(1.6rem, 5vw, 3rem)", lineHeight: 1.02 }}>
          400 harmful tests. SEED blocked all 400.
        </h2>
        <p style={{ margin: "0.8rem 0 0", color: "var(--marble-shadow)", maxWidth: "78ch", lineHeight: 1.55 }}>
          Plain English: we took <strong style={{ color: "var(--marble)" }}>gemma-4-uncensored</strong>, asked it the same dangerous HarmBench questions two ways, then compared the answers. Unwrapped, the model often answers. Wrapped with SEED, the completed run produced <strong style={{ color: "var(--marble)" }}>400 clean refusals out of 400</strong>. No safety theater. Receipts underneath.
        </p>
        <p style={{ margin: "0.8rem 0 0", color: "var(--marble-shadow)", maxWidth: "78ch", lineHeight: 1.55 }}>
          The part that should make people look twice: safety did not make the model dumber in this run. On GPQA Diamond, our science-question check, the SEED line moved from <strong style={{ color: "var(--marble)" }}>45.0% to 54.5%</strong> logprob accuracy. Safer on HarmBench, stronger on GPQA. That is the story.
        </p>
        <p style={{ margin: "0.8rem 0 0", color: "var(--marble-shadow)", maxWidth: "78ch", lineHeight: 1.55 }}>
          This is repro lane 01 for <strong style={{ color: "var(--marble)" }}>Concept 00001 / CANON-01v2-0001: true-name power</strong>. Short form: <strong style={{ color: "var(--marble)" }}>A true name is a name with remembered obligations.</strong> Use <strong style={{ color: "var(--marble)" }}>Run 1–5 random prompts</strong> for a live mini-demo, or open Complete Run Data for the full ledger. The product point is simple: identity and obligation can change model behavior, and the receipt lets anyone check the claim.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 10, marginTop: 18 }}>
          <article style={{ border: "1px solid rgba(111,182,255,0.34)", borderRadius: 18, background: "rgba(111,182,255,0.09)", padding: "0.95rem" }}>
            <p className="mono" style={{ margin: 0, color: "var(--ion)", fontSize: "0.58rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>HarmBench result</p>
            <strong className="display" style={{ display: "block", marginTop: 8, color: "var(--marble)", fontSize: "1.8rem", letterSpacing: "0.04em" }}>0.0%</strong>
            <p style={{ margin: "0.35rem 0 0", color: "var(--marble-shadow)", fontSize: "0.82rem", lineHeight: 1.45 }}>SEED attack success rate in the completed 400-case run.</p>
          </article>
          <article style={{ border: "1px solid rgba(111,182,255,0.34)", borderRadius: 18, background: "rgba(111,182,255,0.09)", padding: "0.95rem" }}>
            <p className="mono" style={{ margin: 0, color: "var(--ion)", fontSize: "0.58rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>Safety behavior</p>
            <strong className="display" style={{ display: "block", marginTop: 8, color: "var(--marble)", fontSize: "1.8rem", letterSpacing: "0.04em" }}>400/400</strong>
            <p style={{ margin: "0.35rem 0 0", color: "var(--marble-shadow)", fontSize: "0.82rem", lineHeight: 1.45 }}>Harmful prompts ended as clean refusals with SEED.</p>
          </article>
          <article style={{ border: "1px solid rgba(185,138,80,0.34)", borderRadius: 18, background: "rgba(185,138,80,0.09)", padding: "0.95rem" }}>
            <p className="mono" style={{ margin: 0, color: "var(--bronze)", fontSize: "0.58rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>Capability check</p>
            <strong className="display" style={{ display: "block", marginTop: 8, color: "var(--marble)", fontSize: "1.8rem", letterSpacing: "0.04em" }}>45.0 → 54.5%</strong>
            <p style={{ margin: "0.35rem 0 0", color: "var(--marble-shadow)", fontSize: "0.82rem", lineHeight: 1.45 }}>GPQA logprob accuracy moved up, not down.</p>
          </article>
          <article style={{ border: "1px solid rgba(206,74,63,0.32)", borderRadius: 18, background: "rgba(206,74,63,0.07)", padding: "0.95rem" }}>
            <p className="mono" style={{ margin: 0, color: "var(--cinnabar)", fontSize: "0.58rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>Try it live</p>
            <strong className="display" style={{ display: "block", marginTop: 8, color: "var(--marble)", fontSize: "1.8rem", letterSpacing: "0.04em" }}>1–5</strong>
            <p style={{ margin: "0.35rem 0 0", color: "var(--marble-shadow)", fontSize: "0.82rem", lineHeight: 1.45 }}>Run fresh random prompts and watch both boxes.</p>
          </article>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 12, marginTop: 16 }}>
          <article style={{ border: "1px solid rgba(111,182,255,0.24)", borderRadius: 20, background: "rgba(111,182,255,0.06)", padding: "1rem" }}>
            <p className="mono" style={{ margin: 0, color: "var(--ion)", fontSize: "0.58rem", letterSpacing: "0.14em", textTransform: "uppercase" }}>For non-technical readers</p>
            <p style={{ margin: "0.7rem 0 0", color: "var(--marble-shadow)", lineHeight: 1.55, fontSize: "0.86rem" }}>
              Think of HarmBench as a bad-ask stress test. We ask the model for things it should not provide. The demo lets you compare the ordinary answer against the SEED answer on the exact same prompt. It is not a universal safety proof. It is a visible benchmark win with receipts.
            </p>
          </article>
          <article style={{ border: "1px solid rgba(185,138,80,0.28)", borderRadius: 20, background: "rgba(185,138,80,0.06)", padding: "1rem" }}>
            <p className="mono" style={{ margin: 0, color: "var(--bronze)", fontSize: "0.58rem", letterSpacing: "0.14em", textTransform: "uppercase" }}>More repro lanes are coming</p>
            <ul style={{ margin: "0.7rem 0 0", paddingLeft: "1.1rem", color: "var(--marble-shadow)", lineHeight: 1.55, fontSize: "0.86rem" }}>
              {futureLanes.map((lane) => <li key={lane}>{lane}</li>)}
            </ul>
          </article>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 18 }}>
          <button onClick={() => setTab("sample")} className="display" style={{ border: `1px solid ${tab === "sample" ? "var(--ion)" : "rgba(168,159,140,0.28)"}`, background: tab === "sample" ? "rgba(111,182,255,0.14)" : "rgba(0,0,0,0.18)", color: tab === "sample" ? "var(--ion)" : "var(--marble-shadow)", borderRadius: 999, padding: "0.66rem 1rem", minHeight: 44, fontSize: "0.62rem", letterSpacing: "0.14em", textTransform: "uppercase" }}>Run sample</button>
          <button onClick={() => setTab("complete")} className="display" style={{ border: `1px solid ${tab === "complete" ? "var(--bronze)" : "rgba(168,159,140,0.28)"}`, background: tab === "complete" ? "rgba(185,138,80,0.14)" : "rgba(0,0,0,0.18)", color: tab === "complete" ? "var(--bronze)" : "var(--marble-shadow)", borderRadius: 999, padding: "0.66rem 1rem", minHeight: 44, fontSize: "0.62rem", letterSpacing: "0.14em", textTransform: "uppercase" }}>Complete run data</button>
        </div>
      </section>

      {tab === "sample" && (
        <section className="carved" style={{ marginTop: 16, padding: "1.25rem", borderColor: "rgba(111,182,255,0.22)" }}>
          {err && <SessionRepairNotice message={err} />}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label className="mono" style={{ color: "var(--inscription)", fontSize: "0.65rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>Sample size</label>
            <select value={sampleSize} onChange={(e) => setSampleSize(Math.max(1, Math.min(5, Number(e.target.value))))} style={{ border: "1px solid rgba(168,159,140,0.28)", borderRadius: 999, background: "rgba(0,0,0,0.22)", color: "var(--marble)", padding: "0.72rem 1rem", minHeight: 46 }}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <select value={split} onChange={(e) => setSplit(e.target.value as EvalSplit | "any")} style={{ border: "1px solid rgba(168,159,140,0.28)", borderRadius: 999, background: "rgba(0,0,0,0.22)", color: "var(--marble)", padding: "0.72rem 1rem", minHeight: 46 }}>
              <option value="any">random from all HarmBench</option>
              <option value="standard">standard</option>
              <option value="contextual">contextual</option>
              <option value="copyright">copyright</option>
            </select>
            <button className="display" disabled={busy || !recipe} onClick={runSample} style={{ border: "1px solid var(--ion)", background: "rgba(111,182,255,0.14)", color: "var(--ion)", borderRadius: 999, padding: "0.78rem 1.3rem", fontSize: "0.66rem", letterSpacing: "0.16em", textTransform: "uppercase", cursor: busy ? "not-allowed" : "pointer", opacity: busy || !recipe ? 0.58 : 1, minHeight: 46 }}>
              {busy ? "Running both boxes…" : `Run ${sampleSize} random prompt${sampleSize === 1 ? "" : "s"}`}
            </button>
            <span className="mono" style={{ color: "var(--inscription)", fontSize: "0.66rem", letterSpacing: "0.08em" }}>sampling: {splitLabel(split)}</span>
          </div>
        </section>
      )}

      {tab === "sample" && run && (
        <section className="carved msg" style={{ marginTop: 16, padding: "1.25rem", borderColor: "rgba(231,211,169,0.24)" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Badge tone="blue">{run.status}</Badge>
            <Badge tone="gold">{row?.case_ref ?? run.sample?.case_refs?.[0] ?? "case pending"}</Badge>
            <Badge tone="marble">{recipe?.model_slug ?? "gemma-4-uncensored"}</Badge>
          </div>

          {evidence.length > 1 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              {evidence.map((item, idx) => (
                <button key={item.case_ref} onClick={() => setSelectedEvidence(idx)} className="mono" style={{ border: `1px solid ${idx === selectedEvidence ? "var(--bronze)" : "rgba(168,159,140,0.22)"}`, background: idx === selectedEvidence ? "rgba(185,138,80,0.12)" : "rgba(0,0,0,0.16)", color: idx === selectedEvidence ? "var(--bronze)" : "var(--marble-shadow)", borderRadius: 999, padding: "0.45rem 0.7rem", minHeight: 44, display: "inline-flex", alignItems: "center", cursor: "pointer" }}>
                  {idx + 1}. {item.case_ref}
                </button>
              ))}
            </div>
          )}

          {row ? (
            <>
              <TextBox title="HarmBench prompt" tone="gold" badge={row.split ?? "prompt"}>{row.prompt || "[prompt missing from evidence row]"}</TextBox>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 14, marginTop: 14 }}>
                <TextBox title="Vanilla gemma-4-uncensored" tone={verdictTone(row.baseline_refused)} badge={verdictText(row, "baseline")}>{row.baseline_output || "[no vanilla output returned]"}</TextBox>
                <TextBox title="Gemma + SEED / our solution" tone={verdictTone(row.seed_refused)} badge={verdictText(row, "seed")}>{row.seed_output || "[no SEED output returned]"}</TextBox>
              </div>
            </>
          ) : (
            <p style={{ color: "var(--cinnabar)", lineHeight: 1.6 }}>Run finished but no visible evidence row came back. That is the wrong product shape; inspect the harness/parser.</p>
          )}

          <details style={{ marginTop: 14 }}>
            <summary className="mono" style={{ color: "var(--inscription)", cursor: "pointer", fontSize: "0.66rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>hashes / receipt</summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit", color: "var(--marble-shadow)", lineHeight: 1.55, fontSize: "0.76rem" }}>
{JSON.stringify({
  run_id: run.run_id,
  receipt_sha256: run.receipt_sha256,
  sample_size: run.sample?.sample_size,
  case_ref: row?.case_ref,
  prompt_hash_sha256: row?.prompt_hash_sha256,
  vanilla_output_hash_sha256: row?.baseline_output_hash_sha256,
  seed_output_hash_sha256: row?.seed_output_hash_sha256,
  seed_sha256: receipt?.seed_sha256,
  manifest_hash: receipt?.manifest_hash,
  sample_selection_hash: receipt?.sample_selection_hash,
}, null, 2)}
            </pre>
          </details>
        </section>
      )}

      {tab === "complete" && (
        <section className="carved" style={{ marginTop: 16, padding: "1.25rem", borderColor: "rgba(185,138,80,0.26)" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Badge tone="gold">Complete run data</Badge>
            <Badge tone="blue">400/400 SEED clean refusals</Badge>
            <Badge tone="marble">GPQA improved</Badge>
          </div>
          <p style={{ color: "var(--marble-shadow)", lineHeight: 1.55, maxWidth: "82ch" }}>
            The completed run is the receipts table. HarmBench is the stress test: 400 harmful asks. In this run, SEED turned every one into a clean refusal. GPQA Diamond is the sanity check: did the model stay useful on hard science questions? It did better, not worse. The table keeps raw bulk prompts and completions out of the public page, but leaves the hashes, probabilities, verdicts, and receipts visible enough to audit.
          </p>

          {completeErr && <SessionRepairNotice message={completeErr} />}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <select value={completeSplit} onChange={(e) => { setCompleteSplit(e.target.value as EvalSplit | "any"); setCompleteOffset(0); setCompleteData(null); }} style={{ border: "1px solid rgba(168,159,140,0.28)", borderRadius: 999, background: "rgba(0,0,0,0.22)", color: "var(--marble)", padding: "0.72rem 1rem", minHeight: 46 }}>
              <option value="any">all splits</option>
              <option value="standard">standard only</option>
              <option value="contextual">contextual only</option>
              <option value="copyright">copyright only</option>
            </select>
            <input value={completeSearch} onChange={(e) => { setCompleteSearch(e.target.value); setCompleteOffset(0); setCompleteData(null); }} placeholder="search case ref / label" style={{ border: "1px solid rgba(168,159,140,0.28)", borderRadius: 999, background: "rgba(0,0,0,0.22)", color: "var(--marble)", padding: "0.72rem 1rem", minHeight: 46, minWidth: 220 }} />
            <button disabled={!canPageBack || completeBusy} onClick={() => setCompleteOffset((n) => Math.max(0, n - 25))} style={{ border: "1px solid rgba(168,159,140,0.28)", background: "rgba(0,0,0,0.18)", color: "var(--marble-shadow)", borderRadius: 999, padding: "0.7rem 1rem", minHeight: 44, opacity: !canPageBack ? 0.5 : 1 }}>Previous</button>
            <button disabled={!canPageForward || completeBusy} onClick={() => setCompleteOffset((n) => n + 25)} style={{ border: "1px solid rgba(168,159,140,0.28)", background: "rgba(0,0,0,0.18)", color: "var(--marble-shadow)", borderRadius: 999, padding: "0.7rem 1rem", minHeight: 44, opacity: !canPageForward ? 0.5 : 1 }}>Next</button>
            {completeBusy && <span style={{ color: "var(--marble-shadow)" }}>Loading…</span>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "-0.25rem 0 0.9rem" }}>
            {(["any", "standard", "contextual", "copyright"] as Array<EvalSplit | "any">).map((value) => {
              const count = value === "any" ? completeData?.total_cases : completeData?.split_counts?.[value];
              const active = completeSplit === value;
              return (
                <button key={value} onClick={() => { setCompleteSplit(value); setCompleteOffset(0); setCompleteData(null); }} className="mono" style={{ border: `1px solid ${active ? "var(--bronze)" : "rgba(168,159,140,0.22)"}`, background: active ? "rgba(185,138,80,0.13)" : "rgba(0,0,0,0.14)", color: active ? "var(--bronze)" : "var(--marble-shadow)", borderRadius: 999, padding: "0.48rem 0.75rem", cursor: "pointer", fontSize: "0.66rem" }}>
                  {splitLabel(value)}{typeof count === "number" ? ` · ${count}` : ""}
                </button>
              );
            })}
          </div>

          <div style={{ border: "1px solid rgba(168,159,140,0.18)", borderRadius: 16, background: "rgba(0,0,0,0.16)", padding: "0.75rem 0.9rem", marginBottom: 14, color: "var(--marble-shadow)", lineHeight: 1.45 }}>
            <strong style={{ color: "var(--marble)" }}>Active ledger filter:</strong> {splitLabel(completeSplit)}
            {completeData ? (
              <> · showing {completeShowingFrom}–{completeShowingTo} of {completeData.filtered_cases ?? completeData.total_cases} matching cases ({completeData.total_cases} total)</>
            ) : completeBusy ? (
              <> · loading filtered rows…</>
            ) : null}
          </div>

          {completeData && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: 10, marginBottom: 14 }}>
                <article style={{ border: "1px solid rgba(111,182,255,0.24)", borderRadius: 16, padding: "0.9rem", background: "rgba(111,182,255,0.06)" }}><div className="mono" style={{ color: "var(--ion)", fontSize: "0.58rem" }}>Selected HarmBench asks</div><strong style={{ color: "var(--marble)", fontSize: "1.4rem" }}>{selectedHarmBenchCases}</strong><p style={{ margin: "0.25rem 0 0", color: "var(--marble-shadow)", fontSize: "0.72rem" }}>{completeSplit === "any" && !completeSearch.trim() ? "full 400-case run" : `${splitLabel(completeSplit)} / filtered view`}</p></article>
                <article style={{ border: "1px solid rgba(111,182,255,0.24)", borderRadius: 16, padding: "0.9rem", background: "rgba(111,182,255,0.06)" }}><div className="mono" style={{ color: "var(--ion)", fontSize: "0.58rem" }}>Attack success with SEED</div><strong style={{ color: "var(--marble)", fontSize: "1.4rem" }}>{selectedHarmBenchCases ? pct(selectedSeedNonRefusals / selectedHarmBenchCases) : "—"}</strong><p style={{ margin: "0.25rem 0 0", color: "var(--marble-shadow)", fontSize: "0.72rem" }}>{selectedCleanRefusals}/{selectedHarmBenchCases} clean refusals in this view</p></article>
                <article style={{ border: "1px solid rgba(185,138,80,0.24)", borderRadius: 16, padding: "0.9rem", background: "rgba(185,138,80,0.06)" }}><div className="mono" style={{ color: "var(--bronze)", fontSize: "0.58rem" }}>GPQA science accuracy</div><strong style={{ color: "var(--marble)", fontSize: "1.4rem" }}>{pct(metric(gpqaMetrics, "baseline_logprob_accuracy"))} → {pct(metric(gpqaMetrics, "seed_logprob_accuracy"))}</strong></article>
                <article style={{ border: "1px solid rgba(185,138,80,0.24)", borderRadius: 16, padding: "0.9rem", background: "rgba(185,138,80,0.06)" }}><div className="mono" style={{ color: "var(--bronze)", fontSize: "0.58rem" }}>Written-answer check</div><strong style={{ color: "var(--marble)", fontSize: "1.4rem" }}>{pct(metric(gpqaMetrics, "baseline_text_accuracy"))} → {pct(metric(gpqaMetrics, "seed_text_accuracy"))}</strong></article>
              </div>

              <details style={{ marginBottom: 14 }} open>
                <summary className="mono" style={{ color: "var(--inscription)", cursor: "pointer", fontSize: "0.66rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>run receipt summary</summary>
                <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit", color: "var(--marble-shadow)", lineHeight: 1.55, fontSize: "0.76rem" }}>
{JSON.stringify({
  harmbench_run_id: completeData.run_id,
  harmbench_seed_sha256: completeData.seed_sha256,
  harmbench_seed_role: completeData.seed_role,
  split_counts: completeData.split_counts,
  classification_counts: completeData.classification_counts,
  filtered_classification_counts: completeData.filtered_classification_counts,
  selected_filter: splitLabel(completeSplit),
  selected_cases: selectedHarmBenchCases,
  gpqa: completeData.gpqa,
}, null, 2)}
                </pre>
              </details>

              <p style={{ margin: "0 0 0.8rem", color: "var(--marble-shadow)", lineHeight: 1.5, fontSize: "0.84rem" }}>
                In the table, PYES is the judge's estimated probability that the answer crossed the harmful line. Good rows move from high vanilla PYES to low SEED PYES.
              </p>
              <div style={{ overflowX: "auto", border: "1px solid rgba(168,159,140,0.16)", borderRadius: 18 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                  <thead>
                    <tr style={{ color: "var(--inscription)", textAlign: "left" }}>
                      <th style={{ padding: "0.62rem" }}>case</th><th style={{ padding: "0.62rem" }}>split</th><th style={{ padding: "0.62rem" }}>category</th><th style={{ padding: "0.62rem" }}>label</th><th style={{ padding: "0.62rem" }}>vanilla</th><th style={{ padding: "0.62rem" }}>SEED</th><th style={{ padding: "0.62rem" }}>PYES</th><th style={{ padding: "0.62rem" }}>hashes</th>
                    </tr>
                  </thead>
                  <tbody>{completeData.rows.map((item) => <CompleteRow key={item.case_ref} row={item} />)}</tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </ToolShell>
  );
}
