"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const style = {
    border: "1px solid var(--inscription)",
    background: "rgba(212,194,154,0.06)",
    color: "var(--inscription)",
    borderRadius: 9999,
    padding: "0.6rem 1.25rem",
    fontSize: "0.66rem",
    letterSpacing: "0.2em",
    cursor: "pointer",
    minHeight: 44,
  } as const;
  if (isConnected) {
    return (
      <button className="display" style={style} onClick={() => disconnect()}>
        {short(address)} · SIGN OUT
      </button>
    );
  }
  return (
    <div style={{ position: "relative" }}>
      <button className="display" style={style} onClick={() => setOpen((o) => !o)}>
        {isPending ? "CONNECTING…" : "CONNECT WALLET"}
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 50, minWidth: 220, padding: 8, borderRadius: 14, border: "1px solid var(--marble-deep)", background: "var(--abyss)", boxShadow: "0 12px 44px rgba(0,0,0,0.55)" }}>
          {connectors.map((c) => (
            <button
              key={c.uid}
              className="display"
              onClick={() => connect({ connector: c }, { onSuccess: () => setOpen(false) })}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 10, border: "none", background: "transparent", color: "var(--marble)", fontSize: "0.74rem", letterSpacing: "0.05em", cursor: "pointer" }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
