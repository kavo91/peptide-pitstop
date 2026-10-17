import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
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
 * Returns { ok: true, baseline } on a 2xx from the sidecar, else { ok: false, error }.
 * `baseline` is the newest Garmin `syncedAt` BEFORE the kick (ISO, or null if
 * none yet). The button polls /api/wellness/sync-status until the newest
 * `syncedAt` moves past it — server time against server time, so a phone whose
 * clock is off can't make it fire early or never.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Read the baseline before the kick, so the sync's own write lands after it.
  const latest = await prisma.wearableDaily.aggregate({
    where: { userId: user.id, source: "garmin" },
    _max: { syncedAt: true },
  });
  const baseline = latest._max.syncedAt?.toISOString() ?? null;

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
    return NextResponse.json({ ok: true, baseline });
  } catch (err) {
    console.error("[wellness/sync-now] failed to reach sidecar", err);
    return NextResponse.json(
      { ok: false, error: "Could not reach garmin-sync" },
      { status: 502 },
    );
  }
}
