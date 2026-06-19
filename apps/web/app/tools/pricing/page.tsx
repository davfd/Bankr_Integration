"use client";

import { useState } from "react";
import { ToolShell } from "@/components/platform/ToolShell";

const ROWS: [string, string][] = [
  ["Chat with Leonardo — first 5 messages", "Free"],
  ["Chat with Leonardo — after that", "~$0.02 / message"],
  ["Council · full panel (5 critics + ruling)", "$0.25"],
  ["Council · quick single critic", "$0.05"],
  ["Council plan/audit intake receipt", "$0.25 · queue access"],
  ["Imagination graph search", "Free"],
  ["Workshop research brief", "Free (beta)"],
  ["Workshop build/reproduction intake receipt", "$0.25 · queue access"],
  ["Agent Passport (mint an ID)", "Free · you pay only gas"],
  ["Trust Registry (lookups + ratings)", "Free · ratings pay only gas"],
  ["Hosted Agent", "Free (beta) · usage logged"],
];

export default function PricingTool() {
  const [tick] = useState(0);
  return (
    <ToolShell
      title="Metering & Payments"
      tech="Pay-per-use · x402 · test USDC on Base Sepolia"
      blurb="No subscription. Paid actions are tiny automatic payments from your connected wallet — confirmed by you, settled on-chain, gasless for the payer. This is a test network: real mechanics, no real money yet."
      status="LIVE · TEST MODE"
      historyKind="chat"
      tick={tick}
      live
    >
      <div className="carved" style={{ padding: "1.5rem" }}>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
          {ROWS.map(([k, v]) => (
            <li key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid rgba(168,159,140,0.12)", paddingBottom: 9 }}>
              <span style={{ color: "var(--marble)", fontSize: "0.95rem" }}>{k}</span>
              <span className="mono" style={{ color: "var(--ion)", fontSize: "0.8rem", whiteSpace: "nowrap" }}>{v}</span>
            </li>
          ))}
        </ul>
        <p style={{ color: "var(--marble-shadow)", fontSize: "0.85rem", marginTop: 16, lineHeight: 1.6 }}>
          Payments ride the x402 protocol: when an action costs money, your wallet is asked to sign a USDC
          authorization for exactly that amount — nothing is charged without your confirmation, and every payment
          settles on-chain where you can verify it. For governed Council/Workshop intake, payments buy queue access and receipts, not truth, verdicts, or results. Going to real money later is a network switch, not a redesign.
        </p>
      </div>
    </ToolShell>
  );
}
