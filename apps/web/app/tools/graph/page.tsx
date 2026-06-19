"use client";

import { useEffect, useMemo, useState } from "react";
import { ToolShell } from "@/components/platform/ToolShell";
import { searchGraph, type GraphHit } from "@/lib/gateway";
import { history } from "@/lib/history";
import {
  COUNCIL_MEMORY_AGENT_INSTRUCTIONS,
  COUNCIL_MEMORY_MCP_SCOPES,
  GRAPH_AGENT_INSTRUCTIONS,
  IMAGINATION_GRAPH_MCP_SCOPES,
  buildGenericMcpConfig,
  buildHermesMcpConfig,
  createMcpToken as createDevToken,
  graphMcpEndpoint,
  listMcpTokens as fetchMcpTokens,
  revokeMcpToken as revokeDevToken,
  rotateMcpToken as rotateDevToken,
  smokeMcpToken,
  type McpAccessProfile,
  type McpToken,
} from "@/lib/mcp-tokens";

type DoctorState = { ok: boolean; message: string };

type McpTile = {
  profile: McpAccessProfile;
  title: string;
  eyebrow: string;
  copy: string;
  defaultLabel: string;
  scopes: readonly string[];
  hermesKey: string;
  genericName: string;
  instructions: string;
};

const EMPTY_TOKEN_STATE: Record<McpAccessProfile, string | null> = { graph: null, council_memory: null };
const EMPTY_DOCTOR_STATE: Record<McpAccessProfile, DoctorState | null> = { graph: null, council_memory: null };

const MCP_TILES: McpTile[] = [
  {
    profile: "graph",
    title: "Imagination Graph MCP",
    eyebrow: "Agent MCP access · provenance graph",
    copy:
      "Generate a developer token for read-only graph and scriptural-reference tools — no writes, no raw Cypher, no database credentials. Beta tokens last 48 hours and are shown once. Generating a new token revokes your prior active token; revoke or rotate if leaked.",
    defaultLabel: "My Imagination Graph MCP agent",
    scopes: IMAGINATION_GRAPH_MCP_SCOPES,
    hermesKey: "leonardo_graph",
    genericName: "leonardo-graph",
    instructions: GRAPH_AGENT_INSTRUCTIONS,
  },
  {
    profile: "council_memory",
    title: "Council Memory MCP",
    eyebrow: "Agent MCP access · bounded Council precedent",
    copy:
      "Generate a developer token for bounded Council Memory precedent search. Council Memory is testimony, not truth; it is not raw memory, verdict authority, or a write path. Beta tokens last 48 hours and are shown once. Generating a new token revokes your prior active token; revoke or rotate if leaked.",
    defaultLabel: "My Council Memory MCP agent",
    scopes: COUNCIL_MEMORY_MCP_SCOPES,
    hermesKey: "leonardo_council_memory",
    genericName: "leonardo-council-memory",
    instructions: COUNCIL_MEMORY_AGENT_INSTRUCTIONS,
  },
];

function profileForScopes(scopes: string[]): McpAccessProfile {
  return scopes.length === 1 && scopes[0] === "council_memory:read" ? "council_memory" : "graph";
}

function CopyBlock({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="carved" style={{ padding: "1rem", display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span className="mono" style={{ color: "var(--inscription)", fontSize: "0.55rem", letterSpacing: "0.18em", textTransform: "uppercase" }}>{title}</span>
        <button type="button" onClick={copy} className="mono" style={{ border: "1px solid rgba(111,182,255,0.35)", background: "rgba(111,182,255,0.08)", color: "var(--ion)", borderRadius: 9999, padding: "5px 10px", fontSize: "0.58rem", cursor: "pointer" }}>
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--marble-shadow)", fontSize: "0.76rem", lineHeight: 1.5 }}>{text}</pre>
    </div>
  );
}

export default function GraphTool() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GraphHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [tokenErr, setTokenErr] = useState<string | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [labels, setLabels] = useState<Record<McpAccessProfile, string>>({
    graph: MCP_TILES[0]!.defaultLabel,
    council_memory: MCP_TILES[1]!.defaultLabel,
  });
  const [newTokens, setNewTokens] = useState<Record<McpAccessProfile, string | null>>(EMPTY_TOKEN_STATE);
  const [doctors, setDoctors] = useState<Record<McpAccessProfile, DoctorState | null>>(EMPTY_DOCTOR_STATE);

  const endpoint = useMemo(() => graphMcpEndpoint(), []);

  async function loadTokens() {
    try {
      setTokenErr(null);
      setTokens(await fetchMcpTokens());
    } catch (e) {
      setTokenErr(e instanceof Error ? e.message : "Sign in to manage MCP tokens.");
    }
  }

  useEffect(() => {
    loadTokens().catch(() => {});
  }, []);

  async function run() {
    if (q.trim().length < 2) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await searchGraph(q.trim());
      setHits(res);
      history.add("graph", q.trim(), res.slice(0, 6).map((h) => h.name).join(" · ") || "no hits").finally(() => setTick((t) => t + 1));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Search failed.");
      setHits(null);
    } finally {
      setBusy(false);
    }
  }

  async function createToken(tile: McpTile) {
    setTokenBusy(true);
    setTokenErr(null);
    setDoctors((prev) => ({ ...prev, [tile.profile]: null }));
    try {
      const out = await createDevToken({ label: labels[tile.profile], scopes: [...tile.scopes] });
      setNewTokens({ ...EMPTY_TOKEN_STATE, [tile.profile]: out.token });
      setDoctors(EMPTY_DOCTOR_STATE);
      await loadTokens();
    } catch (e) {
      setTokenErr(e instanceof Error ? e.message : "Token creation failed.");
    } finally {
      setTokenBusy(false);
    }
  }

  async function revoke(id: string) {
    setTokenBusy(true);
    setTokenErr(null);
    try {
      await revokeDevToken(id);
      setNewTokens(EMPTY_TOKEN_STATE);
      await loadTokens();
    } catch (e) {
      setTokenErr(e instanceof Error ? e.message : "Revoke failed.");
    } finally {
      setTokenBusy(false);
    }
  }

  async function rotate(id: string, profile: McpAccessProfile) {
    setTokenBusy(true);
    setTokenErr(null);
    setDoctors((prev) => ({ ...prev, [profile]: null }));
    try {
      const out = await rotateDevToken(id);
      const nextProfile = profileForScopes(out.record.scopes);
      setNewTokens({ ...EMPTY_TOKEN_STATE, [nextProfile]: out.token });
      await loadTokens();
    } catch (e) {
      setTokenErr(e instanceof Error ? e.message : "Rotate failed.");
    } finally {
      setTokenBusy(false);
    }
  }

  async function doctorCheck(profile: McpAccessProfile) {
    const token = newTokens[profile];
    if (!token) {
      setDoctors((prev) => ({ ...prev, [profile]: { ok: false, message: "Generate or rotate a token first; secrets are shown only once." } }));
      return;
    }
    setDoctors((prev) => ({ ...prev, [profile]: null }));
    const result = await smokeMcpToken(token, profile);
    setDoctors((prev) => ({ ...prev, [profile]: result }));
  }

  function renderMcpTile(tile: McpTile) {
    const token = newTokens[tile.profile] ?? undefined;
    const doctor = doctors[tile.profile];
    return (
      <section key={tile.profile} className="carved" style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
        <div>
          <div className="mono" style={{ fontSize: "0.56rem", letterSpacing: "0.22em", color: "var(--ion)", textTransform: "uppercase" }}>
            {tile.eyebrow}
          </div>
          <h2 className="display" style={{ color: "var(--marble)", fontSize: "clamp(1.25rem, 2vw, 1.8rem)", margin: "0.35rem 0 0" }}>{tile.title}</h2>
          <p style={{ color: "var(--marble-shadow)", margin: "8px 0 0", lineHeight: 1.6 }}>{tile.copy}</p>
          <p className="mono" style={{ color: "var(--marble-deep)", margin: "8px 0 0", fontSize: "0.56rem", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Scopes: {tile.scopes.join(", ")}
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={labels[tile.profile]}
            onChange={(e) => setLabels((prev) => ({ ...prev, [tile.profile]: e.target.value }))}
            aria-label={`${tile.title} token label`}
            style={{ flex: "1 1 240px", background: "var(--obsidian)", color: "var(--marble)", border: "1px solid rgba(168,159,140,0.25)", borderRadius: 9999, padding: "0.7rem 1rem", fontFamily: "inherit" }}
          />
          <button type="button" disabled={tokenBusy} onClick={() => createToken(tile)} className="display" style={{ border: "1px solid var(--ion)", background: "rgba(111,182,255,0.1)", color: "var(--ion)", borderRadius: 9999, padding: "0.72rem 1.3rem", fontSize: "0.62rem", letterSpacing: "0.16em", cursor: tokenBusy ? "not-allowed" : "pointer" }}>
            Generate token
          </button>
          <button type="button" disabled={tokenBusy || !token} onClick={() => doctorCheck(tile.profile)} className="display" style={{ border: "1px solid var(--bronze)", background: "rgba(185,138,80,0.08)", color: "var(--bronze)", borderRadius: 9999, padding: "0.72rem 1.3rem", fontSize: "0.62rem", letterSpacing: "0.16em", cursor: tokenBusy || !token ? "not-allowed" : "pointer", opacity: tokenBusy || !token ? 0.6 : 1 }}>
            Test connection
          </button>
        </div>

        {tokenErr && <p style={{ color: "var(--cinnabar)", margin: 0, fontSize: "0.86rem" }}>{tokenErr}</p>}
        {doctor && <p style={{ color: doctor.ok ? "var(--ion)" : "var(--cinnabar)", margin: 0, fontSize: "0.86rem" }}>{doctor.message}</p>}
        {token && <CopyBlock title={`Show-once ${tile.title} token`} text={token} />}

        <div style={{ display: "grid", gap: "0.8rem" }}>
          <CopyBlock title="Hermes config" text={buildHermesMcpConfig(endpoint, token, tile.hermesKey)} />
          <CopyBlock title="Generic Streamable HTTP MCP config" text={buildGenericMcpConfig(endpoint, token, tile.genericName)} />
          <CopyBlock title="Agent instruction block" text={tile.instructions} />
        </div>
      </section>
    );
  }

  return (
    <ToolShell
      title="Imagination Graph"
      tech="577,000 concepts · 1M mentions · read-only provenance"
      blurb="Search by hand, or generate read-only MCP tokens so an external agent can query Leonardo's Imagination Graph or bounded Council Memory with provenance discipline."
      status="LIVE · MCP BETA"
      historyKind="graph"
      tick={tick}
      live
    >
      <div style={{ display: "grid", gap: "1rem" }}>
        <section className="carved" style={{ padding: "1.5rem" }}>
          <div className="mono" style={{ fontSize: "0.56rem", letterSpacing: "0.22em", color: "var(--inscription)", textTransform: "uppercase", marginBottom: 12 }}>
            Human search
          </div>
          <form onSubmit={(e) => { e.preventDefault(); run(); }} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="e.g. memory palace, true name, resurrection…"
              aria-label="Search the imagination graph"
              style={{ flex: "1 1 260px", background: "var(--obsidian)", color: "var(--marble)", border: "1px solid rgba(168,159,140,0.25)", borderRadius: 9999, padding: "0.75rem 1.1rem", fontFamily: "inherit", fontSize: "0.95rem" }}
            />
            <button
              type="submit"
              className="display"
              disabled={busy || q.trim().length < 2}
              style={{ border: "1px solid var(--ion)", background: "rgba(111,182,255,0.1)", color: "var(--ion)", borderRadius: 9999, padding: "0.75rem 1.5rem", fontSize: "0.64rem", letterSpacing: "0.16em", textTransform: "uppercase", cursor: busy ? "not-allowed" : "pointer", opacity: busy || q.trim().length < 2 ? 0.6 : 1, minHeight: 44 }}
            >
              {busy ? "Searching…" : "Search"}
            </button>
          </form>
          {err && <p style={{ color: "var(--cinnabar)", marginTop: 14, fontSize: "0.88rem" }}>{err}</p>}
          {hits && (
            <div style={{ marginTop: 18 }}>
              {hits.length === 0 ? (
                <p style={{ color: "var(--marble-shadow)" }}>No concepts found.</p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
                  {hits.map((h) => (
                    <li key={h.id} className="msg" style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid rgba(168,159,140,0.12)", paddingBottom: 9 }}>
                      <div>
                        <div style={{ color: "var(--marble)", fontSize: "0.95rem" }}>{h.name}</div>
                        <div className="mono" style={{ color: "var(--marble-deep)", fontSize: "0.55rem", letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 3 }}>
                          {[h.domain, h.sourceKind].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </div>
                      <span className="mono" style={{ color: "var(--ion)", fontSize: "0.76rem", whiteSpace: "nowrap" }}>{h.mentions.toLocaleString()} mentions</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="carved" style={{ padding: "1.5rem", display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <div>
            <div className="mono" style={{ fontSize: "0.54rem", letterSpacing: "0.2em", color: "var(--inscription)", textTransform: "uppercase", marginBottom: 8 }}>
              What the two MCP surfaces mean
            </div>
            <h2 className="display" style={{ color: "var(--marble)", fontSize: "1.2rem", margin: 0 }}>Imagination Graph</h2>
            <p style={{ color: "var(--marble-shadow)", margin: "8px 0 0", lineHeight: 1.6 }}>
              Imagination Graph maps invented concepts back to source evidence: concept mentions, chunks, works, and authors. Use it for invention search, provenance, nearby concepts, and read-only scriptural-reference parallels.
            </p>
          </div>
          <div>
            <div className="mono" style={{ fontSize: "0.54rem", letterSpacing: "0.2em", color: "var(--inscription)", textTransform: "uppercase", marginBottom: 8 }}>
              Council precedent, not raw memory
            </div>
            <h2 className="display" style={{ color: "var(--marble)", fontSize: "1.2rem", margin: 0 }}>Council Memory</h2>
            <p style={{ color: "var(--marble-shadow)", margin: "8px 0 0", lineHeight: 1.6 }}>
              Council Memory searches prior Council testimony and precedent. Use it to find earlier rulings, warnings, and review summaries; it is testimony, not truth, not verdict authority, and not a write path.
            </p>
          </div>
          <div>
            <div className="mono" style={{ fontSize: "0.54rem", letterSpacing: "0.2em", color: "var(--inscription)", textTransform: "uppercase", marginBottom: 8 }}>
              Beta surface, not the whole stack
            </div>
            <h2 className="display" style={{ color: "var(--marble)", fontSize: "1.2rem", margin: 0 }}>Independent MCP beta</h2>
            <p style={{ color: "var(--marble-shadow)", margin: "8px 0 0", lineHeight: 1.6 }}>
              Closed-beta MCP access is an independent developer surface, not the complete Agent Trust Stack. The complete system adds Council/Workshop intake, receipts, gates, and token rails around work that survives judgment.
            </p>
          </div>
        </section>

        <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))" }}>
          {MCP_TILES.map(renderMcpTile)}
        </div>

        <section className="carved" style={{ padding: "1.5rem", display: "grid", gap: "0.8rem" }}>
          <div className="mono" style={{ fontSize: "0.54rem", letterSpacing: "0.2em", color: "var(--inscription)", textTransform: "uppercase" }}>
            Known MCP tokens{tokens.length ? ` · ${tokens.length}` : ""}
          </div>
          <p style={{ color: "var(--marble-shadow)", margin: 0, fontSize: "0.86rem" }}>
            Beta rule: one active token per wallet. Generating or rotating either tile revokes the prior active token for this wallet.
          </p>
          {tokens.length === 0 ? (
            <p style={{ color: "var(--marble-deep)", margin: 0, fontSize: "0.86rem" }}>No tokens yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {tokens.map((t) => {
                const profile = profileForScopes(t.scopes);
                return (
                  <div key={t.id} className="msg" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", borderBottom: "1px solid rgba(168,159,140,0.1)", paddingBottom: 8, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ color: "var(--marble)", fontSize: "0.9rem" }}>{t.label}</div>
                      <div className="mono" style={{ color: "var(--marble-deep)", fontSize: "0.54rem", letterSpacing: "0.1em", marginTop: 3 }}>
                        {t.id} · {t.scopes.join(", ")} · expires {t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : "never"}{t.revokedAt ? ` · revoked ${new Date(t.revokedAt).toLocaleDateString()}` : ""}{t.lastUsedAt ? ` · last ${new Date(t.lastUsedAt).toLocaleString()}` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" disabled={tokenBusy || Boolean(t.revokedAt)} onClick={() => rotate(t.id, profile)} className="mono" style={{ border: "1px solid rgba(111,182,255,0.35)", background: "transparent", color: "var(--ion)", borderRadius: 9999, padding: "6px 10px", cursor: tokenBusy || t.revokedAt ? "not-allowed" : "pointer", opacity: tokenBusy || t.revokedAt ? 0.5 : 1 }}>rotate</button>
                      <button type="button" disabled={tokenBusy || Boolean(t.revokedAt)} onClick={() => revoke(t.id)} className="mono" style={{ border: "1px solid rgba(190,74,58,0.45)", background: "transparent", color: "var(--cinnabar)", borderRadius: 9999, padding: "6px 10px", cursor: tokenBusy || t.revokedAt ? "not-allowed" : "pointer", opacity: tokenBusy || t.revokedAt ? 0.5 : 1 }}>{t.revokedAt ? "revoked" : "revoke"}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </ToolShell>
  );
}
