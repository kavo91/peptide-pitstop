import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";

export const dynamic = "force-dynamic";

/**
 * GET /api/wellness/sync-status?since=<ISO>
 *
 * Polled by the "Sync now" button after it kicks the sidecar. Returns the newest
 * Garmin `syncedAt` for the signed-in user and how many Garmin days were written
 * after `since` (the baseline /api/wellness/sync-now returned). Garmin rows only:
 * a native Apple Health import landing mid-poll must not read as "Garmin synced".
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

  const where = { userId: user.id, source: "garmin" };
  const [latest, updated] = await Promise.all([
    prisma.wearableDaily.aggregate({ where, _max: { syncedAt: true } }),
    prisma.wearableDaily.count({ where: since ? { ...where, syncedAt: { gt: since } } : where }),
  ]);

  return NextResponse.json(
    { ok: true, latestSyncedAt: latest._max.syncedAt?.toISOString() ?? null, updated },
    { headers: { "Cache-Control": "no-store" } },
  );
}
