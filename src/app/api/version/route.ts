import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";

// Deliberately unauthenticated (the middleware matcher excludes it): the PWA
// version heartbeat must be able to read this from any auth state, and it
// discloses nothing beyond the running version string.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { version: APP_VERSION },
    { headers: { "cache-control": "no-store" } },
  );
}
