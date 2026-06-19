import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const runtime = "nodejs";

// Re-expose the session token to an already-signed-in browser (sessions created
// before the free tier shipped have the cookie but never stored the token).
// The cookie itself authenticates this call.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const value = req.cookies.get(SESSION_COOKIE)?.value;
  const wallet = await verifySession(value);
  if (!wallet || !value) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, token: value, wallet });
}
