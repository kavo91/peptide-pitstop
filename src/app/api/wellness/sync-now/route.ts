import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/owner";

const DEFAULT_SYNC_URL = "http://garmin-sync:8080/sync";

/**
 * POST /api/wellness/sync-now
 *
 * Session-authed "Sync now" trigger. Forwards an on-demand pull request to the
 * garmin-sync sidecar's compose-internal endpoint (GARMIN_SYNC_URL, default
 * http://garmin-sync:8080/sync). The sidecar does the Garmin pull and POSTs back
 * to /api/wellness/garmin, so this route only kicks it off.
 *
 * Returns { ok: true } on a 2xx from the sidecar, else { ok: false, error }.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.GARMIN_SYNC_URL || DEFAULT_SYNC_URL;
  try {
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
      console.error(`[wellness/sync-now] sidecar responded ${res.status}`);
      return NextResponse.json(
        { ok: false, error: `Sidecar error (${res.status})` },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[wellness/sync-now] failed to reach sidecar", err);
    return NextResponse.json(
      { ok: false, error: "Could not reach garmin-sync" },
      { status: 502 },
    );
  }
}
