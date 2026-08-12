import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth/session";

const PUBLIC = ["/login", "/setup"];

// Bearer-token API routes that authenticate themselves (no session cookie).
// The session gate must let these through to their OWN authentication. Garmin
// and cron use scoped bearer secrets, native apps use revocable per-device
// credentials, and Stripe uses its signed raw-body webhook.
// Session-authed routes (/api/wellness/sync-now, /api/export/*) stay gated below.
const BEARER_API = [
  "/api/cron/planned",
  "/api/cron/reminders",
  "/api/wellness/garmin",
  "/api/wellness/native", // iOS HealthKit + Android Health Connect ingest (P0)
  "/api/enrichment/refresh",
  "/api/billing/webhook", // Stripe Managed Payments — signed raw-body webhook (P0)
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
  // apple-touch-icon, the service worker (a redirect on the SW script
  // request fails registration; a redirect on the apple-touch-icon breaks the
  // iOS home-screen icon), and the version endpoint (the PWA heartbeat must
  // read it from any auth state; it discloses only the version string).
  matcher: ["/((?!_next/static|_next/image|icons|manifest.webmanifest|favicon.ico|apple-touch-icon.png|sw.js|api/version).*)"],
};
