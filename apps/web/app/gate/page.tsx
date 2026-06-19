"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export default function Gate() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function enter() {
    if (!address) return;
    setBusy(true);
    setErr("");
    try {
      const message = `Leonardo Platform — sign in to enter.\nAddress: ${address}\nTime: ${new Date().toISOString()}`;
      const signature = await signMessageAsync({ message });
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, message, signature }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string; token?: string };
      if (!j.ok) {
        setErr(j.error ?? "Not authorized.");
        setBusy(false);
        return;
      }
      if (j.token) localStorage.setItem("leo_session", j.token); // for the gateway free tier
      const next = new URLSearchParams(window.location.search).get("next") ?? "/";
      window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sign-in failed.");
      setBusy(false);
    }
  }

  const btn = {
    border: "1px solid var(--ion)",
    background: "rgba(111,182,255,0.12)",
    color: "var(--ion)",
    borderRadius: 9999,
    padding: "0.85rem 1.5rem",
    fontSize: "0.72rem",
    letterSpacing: "0.22em",
    cursor: "pointer",
    width: "100%",
  } as const;

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "var(--obsidian, #0A0B12)",
        color: "var(--marble, #EEE9DD)",
      }}
    >
      <div className="carved" style={{ width: "100%", maxWidth: 420, padding: "2.2rem", textAlign: "center", position: "relative" }}>
        <span
          aria-hidden
          style={{ position: "absolute", insetInline: 0, top: 0, height: 1, background: "linear-gradient(90deg,transparent,var(--ion) 50%,transparent)" }}
        />
        <p className="mono" style={{ fontSize: "0.55rem", letterSpacing: "0.4em", color: "var(--inscription)", textTransform: "uppercase" }}>
          Leonardo · Private Beta
        </p>
        <h1 className="display gold-leaf" style={{ fontSize: "1.7rem", margin: "1rem 0 0.5rem", lineHeight: 1.05 }}>
          Sign in with your wallet
        </h1>
        <p style={{ color: "var(--marble-shadow)", fontSize: "0.92rem", lineHeight: 1.6, margin: "0 0 1.6rem" }}>
          Connect a wallet holding $LEO on Base and sign a message to enter. No password — your token is the key.
        </p>

        {!isConnected ? (
          <div style={{ position: "relative" }}>
            <button className="display" style={btn} onClick={() => setPick((o) => !o)}>
              {isPending ? "CONNECTING…" : "CONNECT WALLET"}
            </button>
            {pick && (
              <div style={{ marginTop: 10, padding: 8, borderRadius: 14, border: "1px solid var(--marble-deep)", background: "var(--abyss)" }}>
                {connectors.map((c) => (
                  <button
                    key={c.uid}
                    className="display"
                    onClick={() => connect({ connector: c }, { onError: (e) => setErr(e.message), onSuccess: () => setPick(false) })}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 10, border: "1px solid transparent", background: "transparent", color: "var(--marble)", fontSize: "0.74rem", letterSpacing: "0.05em", cursor: "pointer" }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <button className="display" style={btn} disabled={busy} onClick={enter}>
              {busy ? "CHECK YOUR WALLET…" : "SIGN IN TO ENTER"}
            </button>
            <button
              className="mono"
              onClick={() => disconnect()}
              style={{ background: "none", border: "none", color: "var(--marble-deep)", fontSize: "0.62rem", letterSpacing: "0.18em", cursor: "pointer" }}
            >
              {short(address)} · USE A DIFFERENT WALLET
            </button>
          </div>
        )}

        {err && <p style={{ color: "var(--bronze)", fontSize: "0.78rem", lineHeight: 1.5, marginTop: 16 }}>{err}</p>}
      </div>
    </main>
  );
}
