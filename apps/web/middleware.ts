import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, GATE_COOKIE } from "./lib/session";

// Edge middleware is a no-secret routing gate only. It must not import the HMAC
// signer or on-chain $LEO checker: those need Node/gateway runtime env and made
// local/edge builds 500 when SESSION_SECRET was not visible inside the Edge
// sandbox. Hard authorization remains in /api/auth (wallet signature + $LEO
// check) and gateway/API calls (signed x-leo-session). The page shell requires
// both cookies to avoid casual ungated browsing, but invalid/forged cookies still
// cannot mint MCP tokens or call paid/read APIs.
//
// The gate page + auth API are always reachable. Any *.vercel.app alias is
// redirected to the canonical host.
const CANONICAL_HOST = "app.leonardo-ai.io";

function toGate(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone();
  const next = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  url.pathname = "/gate";
  url.search = "";
  if (next && next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const host = req.headers.get("host") ?? "";
  if (host.endsWith(".vercel.app")) {
    const url = req.nextUrl.clone();
    url.protocol = "https:";
    url.host = CANONICAL_HOST;
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/gate") || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const hasSessionCookie = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  const hasGateCookie = Boolean(req.cookies.get(GATE_COOKIE)?.value);
  if (!hasSessionCookie || !hasGateCookie) return toGate(req);

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
