import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";

export const dynamic = "force-dynamic";

/**
 * GET /api/wellness/sync-status?since=<ISO>[&source=eight_sleep]
 *
 * Polled by the "Sync now" button after it kicks the sidecar. Returns the newest
 * Garmin `syncedAt` for the signed-in user and how many Garmin days were written
 * after `since` (the baseline /api/wellness/sync-now returned). Garmin rows only:
 * a native Apple Health import landing mid-poll must not read as "Garmin synced".
 * With `source=eight_sleep` (sync-now's answer when only Eight Sleep started) it
 * reads Eight Sleep rows instead; any other value is Garmin.
 *
 *   Returns: { ok: true, latestSyncedAt: ISO | null, updated: n }
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const sinceRaw = new URL(req.url).searchParams.get("since");
  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (since && Number.isNaN(since.getTime())) {
    return NextResponse.json({ ok: false, error: "Bad since" }, { status: 400 });
  }

  // Which device the button is waiting for (sync-now's `source`); Garmin by default.
  const source = new URL(req.url).searchParams.get("source") === "eight_sleep" ? "eight_sleep" : "garmin";
  const where = { userId: user.id, source };
  const [latest, updated] = await Promise.all([
    prisma.wearableDaily.aggregate({ where, _max: { syncedAt: true } }),
    prisma.wearableDaily.count({ where: since ? { ...where, syncedAt: { gt: since } } : where }),
  ]);

  return NextResponse.json(
    { ok: true, latestSyncedAt: latest._max.syncedAt?.toISOString() ?? null, updated },
    { headers: { "Cache-Control": "no-store" } },
  );
}
