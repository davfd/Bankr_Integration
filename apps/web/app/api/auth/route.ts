import { NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { SESSION_COOKIE, GATE_COOKIE, GATE_RECHECK_MS, createSession, signGate } from "@/lib/session";
import { holdsLeo } from "@/lib/token-gate";

export const runtime = "nodejs";

// Sign-in: the client connects a wallet, signs a fresh message, and posts it
// here. We verify the signature (proves wallet ownership), check the wallet is
// authorized — it holds $LEO on Base, or is on the owner allowlist override —
// then set the session cookie. Replay is bounded by a 5-minute freshness window
// on the signed timestamp.
export async function POST(req: Request): Promise<NextResponse> {
  let body: { address?: string; message?: string; signature?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const { address, message, signature } = body;
  if (!address || !message || !signature) {
    return NextResponse.json({ ok: false, error: "missing fields" }, { status: 400 });
  }

  const t = Date.parse(message.match(/Time:\s*(.+)/)?.[1]?.trim() ?? "");
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > 5 * 60 * 1000) {
    return NextResponse.json({ ok: false, error: "Request expired — try again." }, { status: 400 });
  }

  let valid = false;
  try {
    valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    valid = false;
  }
  if (!valid) return NextResponse.json({ ok: false, error: "Signature invalid." }, { status: 401 });

  // Authorization: PURE token-gating — must hold $LEO on Base. No allowlist
  // override (it was letting 0-balance wallets in). Holders only.
  const authorized = await holdsLeo(address);
  if (!authorized) {
    return NextResponse.json(
      { ok: false, error: "This wallet doesn’t hold $LEO. Acquire $LEO on Base, then sign in." },
      { status: 403 },
    );
  }

  const session = await createSession(address);
  // The token also goes in the body: the client forwards it to the gateway
  // (x-leo-session) to claim its free prompts — the gateway verifies the HMAC.
  const res = NextResponse.json({ ok: true, address, token: session });
  res.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  // Seed the holdings re-check cache so the first page load doesn't re-hit chain.
  res.cookies.set(GATE_COOKIE, await signGate(address, Date.now() + GATE_RECHECK_MS), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  return res;
}
