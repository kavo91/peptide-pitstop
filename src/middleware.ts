import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth/session";

const PUBLIC = ["/login", "/setup"];

// Bearer-token API routes that authenticate themselves (no session cookie).
// The session gate must let these through to their OWN timing-safe bearer check
// (each fails closed: 503 if its token env is unset, 401 if wrong) — otherwise
// the Garmin import sidecar and external cron callers get redirected to /login
// and can never reach the handler. Session-authed routes (/api/wellness/sync-now,
// /api/export/*) deliberately stay gated below.
const BEARER_API = [
  "/api/cron/planned",
  "/api/cron/reminders",
  "/api/wellness/garmin",
  "/api/enrichment/refresh",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  if (BEARER_API.includes(pathname)) {
    return NextResponse.next();
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Gate everything except Next internals, icons, manifest, favicons, the
  // apple-touch-icon, and the service worker (a redirect on the SW script
  // request fails registration; a redirect on the apple-touch-icon breaks the
  // iOS home-screen icon).
  matcher: ["/((?!_next/static|_next/image|icons|manifest.webmanifest|favicon.ico|apple-touch-icon.png|sw.js).*)"],
};
