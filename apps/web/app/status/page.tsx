"use client";

// The platform overview: live proof strip + every function as a card that
// opens its own full page under /tools/*.
import { useEffect, useState, type ReactNode } from "react";
import { ConnectButton } from "@/components/platform/ConnectButton";
import { readRegistry, IDENTITY_REGISTRY, type RegistryInfo } from "@/lib/erc8004";
import { fetchBankrReadiness, fetchIdentity, runBankrLiveSmoke, type BankrLiveSmokeReceipt, type BankrReadinessSummary } from "@/lib/gateway";

type StatusKey = "live" | "building" | "coming";
const STATUS: Record<StatusKey, { label: string; color: string }> = {
  live: { label: "Try it now", color: "var(--ion)" },
  building: { label: "Being built", color: "var(--bronze)" },
  coming: { label: "Coming later", color: "var(--marble-deep)" },
};

function Icon({ name }: { name: string }) {
  const p: Record<string, ReactNode> = {
    id: (<><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M14 10h4M14 14h4M6 16c.7-1.5 4.3-1.5 5 0" /></>),
    council: (<><path d="M12 3v18M5 7l-2 5h4l-2-5zM19 7l-2 5h4l-2-5zM3 12a4 4 0 0 0 8 0M13 12a4 4 0 0 0 8 0M8 21h8" /></>),
    coin: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5c0-1.1 1.1-2 2.5-2s2.5.9 2.5 2-1.1 2-2.5 2-2.5.9-2.5 2 1.1 2 2.5 2 2.5-.9 2.5-2" /></>),
    server: (<><rect x="3" y="4" width="18" height="7" rx="1.5" /><rect x="3" y="13" width="18" height="7" rx="1.5" /><path d="M7 7.5h.01M7 16.5h.01" /></>),
    wrench: (<><path d="M14.5 6.5a3.5 3.5 0 0 1-4.6 4.6L5 16l3 3 4.9-4.9a3.5 3.5 0 0 1 4.6-4.6l-2.5 2.5-2-2 2.5-2.5z" /></>),
    flag: (<><path d="M5 21V4M5 4h11l-1.5 3L16 10H5" /></>),
    lock: (<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3M12 15v2" /></>),
    map: (<><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" /></>),
    arrow: (<><path d="M5 12h14M13 6l6 6-6 6" /></>),
  };
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {p[name]}
    </svg>
  );
}

type Feature = {
  icon: string;
  name: string;
  tech: string;
  explain: string;
  today: string;
  status: StatusKey;
  label?: string;
  progress: number;
  action: string;
  href?: string;
};

const FEATURES: Feature[] = [
  {
    icon: "flag",
    name: "Repro Lab",
    tech: "One prompt · two boxes",
    explain: "A blunt demo: one random HarmBench prompt goes to vanilla Gemma-4 Uncensored and to Gemma-4 with SEED/solution; the page shows the prompt and both outputs side by side.",
    today: "Live demo path: click once, inspect the raw vanilla answer beside the raw SEED answer, plus hashes/receipt. 400-case cached evidence viewer comes next.",
    status: "live",
    label: "Try it",
    progress: 68,
    action: "Open lab",
    href: "/tools/repro",
  },
  {
    icon: "map",
    name: "Imagination Graph",
    tech: "577K concepts · fiction, myth, scriptural reference",
    explain: "Search the library of human imagination — every concept tied to the passage that first imagined it, now with read-only agent access.",
    today: "Working: full search, Leonardo chat integration, and MCP developer tokens for external agents.",
    status: "building",
    label: "Agent access",
    progress: 92,
    action: "Get MCP access",
    href: "/tools/graph",
  },
  {
    icon: "id",
    name: "Agent Passport",
    tech: "Your agent's ID · ERC-8004",
    explain: "Every agent gets a permanent ID recorded on the blockchain, so people can tell a real one from a fake.",
    today: "Working: mint your own straight from your wallet — a real ERC-8004 token on Base Sepolia.",
    status: "building",
    label: "Coming soon",
    progress: 90,
    action: "Preview · history",
    href: "/tools/passport",
  },
  {
    icon: "council",
    name: "Council Review",
    tech: "Five-seat AI review",
    explain: "Five expert AI critics pick your idea apart and a synthesis returns one ruling — before you build.",
    today: "Working: full five-seat panel ($0.25) or a quick single-critic read ($0.05), pay-per-use.",
    status: "building",
    label: "Coming soon",
        progress: 85,
    action: "Preview · history",
    href: "/tools/council",
  },
  {
    icon: "wrench",
    name: "Workshop",
    tech: "Research briefs · graph + Bible + analogues",
    explain: "Give it a concept and it researches a brief: provenance, Bible parallels, the closest modern tech, the top risk.",
    today: "Working in beta: research any concept here or through Leonardo in chat.",
    status: "building",
    label: "Coming soon",
        progress: 65,
    action: "Preview · history",
    href: "/tools/workshop",
  },
  {
    icon: "lock",
    name: "Trust Registry",
    tech: "On-chain reputation · ERC-8004",
    explain: "Look up any agent's on-chain reputation and leave your own rating — recorded forever. No self-ratings.",
    today: "Working in beta: reads + ratings live on Base Sepolia. Validation waits on the ERC-8004 spec.",
    status: "building",
    label: "Coming soon",
        progress: 60,
    action: "Preview · history",
    href: "/tools/trust",
  },
  {
    icon: "server",
    name: "Hosted Agent",
    tech: "Your own agent · isolated per wallet",
    explain: "Your own AI agent on our infrastructure — workspace and memory fully separate. Nothing to install.",
    today: "Working in beta: provision it, talk to it, and watch the integrity gate block autonomous spending.",
    status: "building",
    label: "Coming soon",
        progress: 45,
    action: "Preview · history",
    href: "/tools/agent",
  },
  {
    icon: "coin",
    name: "Metering & Payments",
    tech: "Pay-per-use · x402",
    explain: "No subscription. Paid actions are tiny automatic wallet payments — only when you use them.",
    today: "Working in test mode: 5 free chat messages, then per-use prices. Real money is a config flip away.",
    status: "live",
    label: "Test mode",
    progress: 70,
    action: "See pricing",
    href: "/tools/pricing",
  },
  {
    icon: "flag",
    name: "Quest Board",
    tech: "Earn $LEO",
    explain: "Pick a task — improve the data, test for weaknesses, build something — and get paid once it's checked.",
    today: "Being built: the earn loop lands with the platform database.",
    status: "building",
    progress: 25,
    action: "Soon",
  },
];

const COUNTS = {
  live: FEATURES.filter((f) => f.status === "live").length,
  building: FEATURES.filter((f) => f.status === "building").length,
  coming: FEATURES.filter((f) => f.status === "coming").length,
};
const OVERALL = Math.round(FEATURES.reduce((s, f) => s + f.progress, 0) / FEATURES.length);

function StatusPill({ s, label }: { s: StatusKey; label?: string }) {
  return (
    <span className="mono" style={{ border: `1px solid ${STATUS[s].color}`, color: STATUS[s].color, borderRadius: 9999, padding: "3px 10px", fontSize: "0.52rem", letterSpacing: "0.14em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
      {label ?? STATUS[s].label}
    </span>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--marble-shadow)", fontSize: "0.8rem" }}>
      <span style={{ width: 8, height: 8, borderRadius: 9999, background: color }} />
      {label}
    </span>
  );
}

function BankrValue({ label, value, ready }: { label: "receipt_publish" | "x402_payment" | "governed_writes"; value: string; ready?: boolean }) {
  return (
    <div style={{ minWidth: 220, flex: "1 1 220px" }}>
      <div className="mono" style={{ fontSize: "0.5rem", letterSpacing: "0.18em", color: "var(--marble-deep)", textTransform: "uppercase" }}>{label}</div>
      <div className="mono" style={{ fontSize: "0.74rem", color: ready ? "var(--ion)" : "var(--bronze)", marginTop: 4 }}>{value}</div>
    </div>
  );
}

function bankrHeadline(bankr: BankrReadinessSummary | null, failed: boolean): string {
  if (failed) return "gateway readiness unreachable";
  if (!bankr) return "checking…";
  if (bankr.mode === "invalid_config") return "invalid Bankr config";
  if (!bankr.configured) return "Bankr key missing";
  return "read-only smoke pending";
}

function receiptPublishText(bankr: BankrReadinessSummary | null): string {
  if (!bankr?.receipt_publish) return "not reported";
  if (bankr.receipt_publish.ready) return `ready · ${bankr.receipt_publish.endpoint_path ?? "path configured"}`;
  return `disabled · ${bankr.receipt_publish.reason}`;
}

function x402PaymentText(bankr: BankrReadinessSummary | null): string {
  if (!bankr?.x402_payment) return "not reported";
  if (bankr.x402_payment.ready) return `ready · ${bankr.x402_payment.endpoint_path ?? "path configured"}`;
  if (bankr.x402_payment.requested) return `blocked · ${bankr.x402_payment.reason}`;
  return `disabled · ${bankr.x402_payment.reason}`;
}

function governedWritesText(bankr: BankrReadinessSummary | null): string {
  if (!bankr?.governed_writes) return "not reported";
  if (bankr.governed_writes.ready) return "approval authority ready";
  if (bankr.governed_writes.requested) return `blocked · ${bankr.governed_writes.reason}`;
  return `disabled · ${bankr.governed_writes.reason}`;
}

function liveSmokeText(receipt: BankrLiveSmokeReceipt | null, running: boolean, failed: boolean): string {
  if (running) return "running read_wallet_state smoke…";
  if (failed) return "live smoke request failed";
  if (!receipt) return "not run from this page yet";
  if (receipt.status === "pass") return `pass · ${receipt.result_provider}/${receipt.result_mode} · ${receipt.read_tool}`;
  return `${receipt.status} · ${receipt.blocked_reason ?? "no receipt reason"}`;
}

function liveSmokeTokenCountText(receipt: BankrLiveSmokeReceipt | null): string {
  if (!receipt) return "not observed";
  return Number.isInteger(receipt.active_mcp_token_count) ? String(receipt.active_mcp_token_count) : "missing witness";
}

export default function StatusOverview() {
  const [reg, setReg] = useState<RegistryInfo | null>(null);
  const [regErr, setRegErr] = useState(false);
  const [bankr, setBankr] = useState<BankrReadinessSummary | null>(null);
  const [bankrErr, setBankrErr] = useState(false);
  const [bankrSmoke, setBankrSmoke] = useState<BankrLiveSmokeReceipt | null>(null);
  const [bankrSmokeErr, setBankrSmokeErr] = useState(false);
  const [bankrSmokeRunning, setBankrSmokeRunning] = useState(false);
  useEffect(() => {
    let alive = true;
    // Gateway first (server-side RPC — browsers get rate-limited by the public
    // Base RPC); direct client read only as fallback.
    fetchIdentity()
      .then((r) => alive && setReg(r))
      .catch(() =>
        readRegistry()
          .then((r) => alive && setReg(r))
          .catch(() => alive && setRegErr(true)),
      );
    fetchBankrReadiness()
      .then((r) => alive && setBankr(r))
      .catch(() => alive && setBankrErr(true));
    return () => { alive = false; };
  }, []);

  const runBankrSmoke = async () => {
    setBankrSmokeRunning(true);
    setBankrSmokeErr(false);
    try {
      const receipt = await runBankrLiveSmoke();
      setBankrSmoke(receipt);
    } catch {
      setBankrSmokeErr(true);
    } finally {
      setBankrSmokeRunning(false);
    }
  };

  return (
    <main style={{ position: "relative", zIndex: 2, maxWidth: 1200, margin: "0 auto", padding: "0 1.2rem 5rem" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "1.1rem 0", borderBottom: "1px solid rgba(168,159,140,0.14)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <a href="/" className="display gold-leaf" style={{ fontSize: "0.95rem", letterSpacing: "0.3em" }}>LEONARDO</a>
          <span className="mono" style={{ fontSize: "0.56rem", letterSpacing: "0.18em", color: "var(--marble-shadow)" }}>· TOOLS &amp; STATUS</span>
          <a href="/" className="mono" style={{ fontSize: "0.56rem", letterSpacing: "0.18em", color: "var(--ion)" }}>← BACK TO CHAT</a>
        </div>
        <ConnectButton />
      </header>

      <section style={{ padding: "2.6rem 0 1.4rem" }}>
        <div className="mono" style={{ fontSize: "0.58rem", letterSpacing: "0.3em", color: "var(--inscription)", marginBottom: 14 }}>EARLY BETA · TEST NETWORK</div>
        <h1 className="display gold-leaf" style={{ fontSize: "clamp(2rem, 5vw, 3.4rem)", lineHeight: 1.05, margin: 0, fontWeight: 600 }}>
          Every tool, <span className="marble-leaf">one workshop.</span>
        </h1>
        <p style={{ maxWidth: "62ch", marginTop: 16, color: "var(--marble)", fontSize: "1.02rem", lineHeight: 1.6 }}>
          The direct workspaces are being fitted — coming soon. Leonardo already does all of this for you in the chat, and everything he does lands in each tool's browsable history.
        </p>
      </section>

      <section className="carved" style={{ padding: "1.2rem 1.4rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <span className="display" style={{ fontSize: "0.62rem", letterSpacing: "0.26em", color: "var(--marble-shadow)", textTransform: "uppercase" }}>How far along we are</span>
          <span className="mono" style={{ fontSize: "0.8rem", color: "var(--ion)" }}>{OVERALL}% built</span>
        </div>
        <div className="bar" style={{ marginTop: 12 }}>
          <span style={{ width: `${OVERALL}%`, background: "linear-gradient(90deg, var(--bronze), var(--ion))" }} />
        </div>
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginTop: 14 }}>
          <Legend color="var(--ion)" label={`${COUNTS.live} you can try now`} />
          <Legend color="var(--bronze)" label={`${COUNTS.building} being built`} />
          {COUNTS.coming > 0 && <Legend color="var(--marble-deep)" label={`${COUNTS.coming} coming later`} />}
          <span style={{ marginLeft: "auto", color: "var(--marble-shadow)", fontSize: "0.8rem" }}>Running on a test network — no real money yet.</span>
        </div>
      </section>

      <section className="carved" style={{ padding: "1rem 1.4rem", display: "flex", flexWrap: "wrap", gap: "1.25rem 2.5rem", alignItems: "center", marginTop: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="pulse" />
          <div>
            <div className="mono" style={{ fontSize: "0.5rem", letterSpacing: "0.2em", color: "var(--marble-shadow)", textTransform: "uppercase" }}>Live blockchain check · Base</div>
            <div className="mono" style={{ fontSize: "0.78rem", color: "var(--ion)", marginTop: 3 }}>
              {reg ? `Agent ID registry online · ${reg.name} v${reg.version}` : regErr ? "registry unreachable" : "checking…"}
            </div>
          </div>
        </div>
        <a href={`https://basescan.org/address/${IDENTITY_REGISTRY}`} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: "0.7rem", color: "var(--marble-shadow)", marginLeft: "auto" }}>
          view on Basescan ↗
        </a>
      </section>

      <section className="carved" style={{ padding: "1rem 1.4rem", marginTop: "1rem" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div className="mono" style={{ fontSize: "0.5rem", letterSpacing: "0.2em", color: "var(--marble-shadow)", textTransform: "uppercase" }}>Bankr Rails</div>
            <div className="mono" style={{ fontSize: "0.78rem", color: bankr?.configured ? "var(--ion)" : "var(--bronze)", marginTop: 3 }}>
              {bankrHeadline(bankr, bankrErr)}
            </div>
          </div>
          <span className="mono" style={{ fontSize: "0.58rem", letterSpacing: "0.16em", color: "var(--marble-shadow)", textTransform: "uppercase" }}>
            no live $LEO x402 settlement yet
          </span>
        </div>
        <div style={{ display: "flex", gap: "1rem 1.6rem", flexWrap: "wrap", marginTop: 14 }}>
          <BankrValue label="receipt_publish" value={receiptPublishText(bankr)} ready={bankr?.receipt_publish?.ready} />
          <BankrValue label="x402_payment" value={x402PaymentText(bankr)} ready={bankr?.x402_payment?.ready} />
          <BankrValue label="governed_writes" value={governedWritesText(bankr)} ready={bankr?.governed_writes?.ready} />
        </div>
        <p style={{ fontSize: "0.78rem", color: "var(--marble-shadow)", margin: "12px 0 0", lineHeight: 1.5 }}>
          Product status reads the gateway readiness receipt only: no Bankr write, no wallet signing, no payment execution, no secret display.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
          <button
            type="button"
            onClick={runBankrSmoke}
            disabled={bankrSmokeRunning}
            className="mono"
            style={{ border: "1px solid rgba(120, 200, 255, 0.5)", borderRadius: 999, padding: "0.55rem 0.9rem", background: "rgba(120, 200, 255, 0.08)", color: "var(--ion)", cursor: bankrSmokeRunning ? "wait" : "pointer", letterSpacing: "0.12em", textTransform: "uppercase", fontSize: "0.58rem" }}
          >
            Run read-only Bankr smoke
          </button>
          <div style={{ minWidth: 260, flex: "1 1 260px" }}>
            <div className="mono" style={{ fontSize: "0.5rem", letterSpacing: "0.18em", color: "var(--marble-deep)", textTransform: "uppercase" }}>last_live_smoke</div>
            <div className="mono" style={{ fontSize: "0.74rem", color: bankrSmoke?.status === "pass" ? "var(--ion)" : "var(--bronze)", marginTop: 4 }}>{liveSmokeText(bankrSmoke, bankrSmokeRunning, bankrSmokeErr)}</div>
            <div className="mono" style={{ fontSize: "0.62rem", color: "var(--marble-shadow)", marginTop: 4 }}>active_mcp_token_count: {liveSmokeTokenCountText(bankrSmoke)}</div>
          </div>
        </div>
        <p style={{ fontSize: "0.72rem", color: "var(--marble-shadow)", margin: "10px 0 0", lineHeight: 1.45 }}>
          This action runs only the read_wallet_state live-smoke wrapper when the operator enables it server-side; no Bankr write, no wallet signing, no payment execution.
        </p>
      </section>

      <section style={{ marginTop: "2.4rem" }}>
        <div style={{ display: "grid", gap: "1.1rem", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {FEATURES.map((f) => {
            // Repro Lab and the Imagination Graph access bench are open now; other direct benches stay behind coming-soon copy.
            const enabled = f.name === "Repro Lab" || f.name === "Imagination Graph";
            const href = enabled ? f.href : undefined;
            const action = enabled ? f.action : "Coming soon";
            const label = enabled ? f.label : "Coming soon";
            const Wrapper = href ? "a" : "div";
            return (
              <Wrapper key={f.name} href={href} className="carved surface" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", cursor: href ? "pointer" : "default", opacity: enabled ? 1 : 0.6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <span style={{ color: STATUS[f.status].color, display: "inline-flex" }}><Icon name={f.icon} /></span>
                  <StatusPill s={f.status} label={label} />
                </div>
                <h3 className="display marble-leaf" style={{ fontSize: "1.25rem", margin: "14px 0 0" }}>{f.name}</h3>
                <div className="mono" style={{ fontSize: "0.52rem", letterSpacing: "0.14em", color: "var(--marble-deep)", textTransform: "uppercase", marginTop: 4 }}>{f.tech}</div>
                <p style={{ fontSize: "0.9rem", color: "var(--marble)", marginTop: 12, lineHeight: 1.55 }}>{f.explain}</p>
                <div className="bar" style={{ marginTop: 16 }}>
                  <span style={{ width: `${f.progress}%`, background: STATUS[f.status].color }} />
                </div>
                <p style={{ fontSize: "0.78rem", color: "var(--marble-shadow)", marginTop: 10, lineHeight: 1.5, flex: 1 }}>{f.today}</p>
                <span className="display" style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 8, color: href ? "var(--ion)" : "var(--marble-deep)", fontSize: "0.62rem", letterSpacing: "0.16em", textTransform: "uppercase" }}>
                  {action}
                  {href && <Icon name="arrow" />}
                </span>
              </Wrapper>
            );
          })}
        </div>
      </section>

      <footer style={{ marginTop: "3.5rem", paddingTop: "1.5rem", borderTop: "1px solid rgba(168,159,140,0.14)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <span className="mono" style={{ fontSize: "0.56rem", letterSpacing: "0.2em", color: "var(--marble-shadow)" }}>OFFCHAIN WORK · ONCHAIN PROOF · TEST NETWORK</span>
        <a href="https://www.leonardo-ai.io" className="mono" style={{ fontSize: "0.56rem", letterSpacing: "0.2em", color: "var(--marble-shadow)" }}>← leonardo-ai.io</a>
      </footer>
    </main>
  );
}
