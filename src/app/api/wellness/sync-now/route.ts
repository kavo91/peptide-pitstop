import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";

const DEFAULT_SYNC_URL = "http://garmin-sync:8080/sync";
// Bundled image: the Eight Sleep sidecar listens in the same container.
const DEFAULT_EIGHT_SLEEP_SYNC_URL = "http://localhost:8081/sync";
// The Eight Sleep sidecar may simply not run (no creds): don't let it hold the button up.
const EIGHT_SLEEP_KICK_TIMEOUT_MS = 3000;

// Same container for the bundled image: a healthy sidecar answers at once.
const GARMIN_KICK_TIMEOUT_MS = 10_000;

/**
 * started = data is on its way; failed = it answered but refused (or, for Garmin,
 * it is set up but did not answer); unavailable = not running / no answer and not
 * set up; recent = it pulled moments ago, so nothing new is coming.
 */
type Kick = { state: "started" } | { state: "failed" | "unavailable" | "recent"; error: string };

async function kick(url: string, label: string, timeoutMs: number): Promise<Kick> {
  try {
    const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      await res.body?.cancel(); // free the socket now
      console.error(`[wellness/sync-now] ${label} sidecar responded ${res.status}`);
      return { state: "failed", error: `Sidecar error (${res.status})` };
    }
    // The Eight Sleep sidecar says whether a pull will actually land; garmin-sync always starts one.
    const status = ((await res.json().catch(() => null)) as { status?: string } | null)?.status;
    if (status === "cooldown") return { state: "recent", error: `${label} synced moments ago — try again in a minute` };
    if (status === "paused") return { state: "failed", error: `${label} paused after a refused login` };
    return { state: "started" };
  } catch (err) {
    console.error(`[wellness/sync-now] failed to reach ${label}`, err);
    return { state: "unavailable", error: `Could not reach ${label}` };
  }
}

/**
 * Garmin is set up when the bundled entrypoint would start garmin-sync: a Garmin
 * email in the env or a saved token file (entrypoint.sh, step 5).
 */
function garminConfigured(): boolean {
  if (process.env.GARMIN_EMAIL) return true;
  return existsSync(join(process.env.TOKENS_DIR || "/tokens", "garmin_tokens.json"));
}

async function newestSyncedAt(userId: string, source: "garmin" | "eight_sleep"): Promise<string | null> {
  const latest = await prisma.wearableDaily.aggregate({
    where: { userId, source },
    _max: { syncedAt: true },
  });
  return latest._max.syncedAt?.toISOString() ?? null;
}

/**
 * POST /api/wellness/sync-now
 *
 * Session-authed "Sync now" trigger. Asks BOTH sidecars for an on-demand pull:
 * garmin-sync (GARMIN_SYNC_URL, default http://garmin-sync:8080/sync) and
 * eight-sleep-sync (EIGHT_SLEEP_SYNC_URL, default http://localhost:8081/sync).
 * Each sidecar pulls and POSTs back to its own import route; this route only
 * kicks them off. Either device alone is enough: the call succeeds when at least
 * one sidecar accepted, and is a 502 only when neither did.
 *
 * Returns { ok: true, baseline, otherBaseline, source, garmin, eightSleep } or { ok: false, error }.
 * `source` is the device the button should wait for — Garmin when it started
 * (unchanged behaviour), else Eight Sleep. `baseline` is that source's newest
 * `syncedAt` BEFORE the kick (ISO, or null). The button polls
 * /api/wellness/sync-status?source=… until the newest `syncedAt` moves past it —
 * server time against server time, so a phone whose clock is off can't make it
 * fire early or never. `garmin` / `eightSleep` are "started", "failed" (answered
 * but refused; for Garmin also set up but unreachable — an outage) or
 * "unavailable" (not running and not set up, e.g. no creds — a normal setup).
 * `otherBaseline` is the other device's baseline, for a refresh when it lands.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Read the baselines before the kicks, so the syncs' own writes land after them.
  const [garminBaseline, eightBaseline] = await Promise.all([
    newestSyncedAt(user.id, "garmin"),
    newestSyncedAt(user.id, "eight_sleep"),
  ]);

  const [garminKick, eight] = await Promise.all([
    kick(process.env.GARMIN_SYNC_URL || DEFAULT_SYNC_URL, "garmin-sync", GARMIN_KICK_TIMEOUT_MS),
    kick(process.env.EIGHT_SLEEP_SYNC_URL || DEFAULT_EIGHT_SLEEP_SYNC_URL, "eight-sleep-sync", EIGHT_SLEEP_KICK_TIMEOUT_MS),
  ]);
  // Garmin set up but its sidecar unreachable is an outage, not "no Garmin": report it as
  // failed, so the button says "Garmin did not start" and a cooldown tap can't hide it.
  const garmin: Kick =
    garminKick.state === "unavailable" && garminConfigured() ? { state: "failed", error: garminKick.error } : garminKick;

  // Eight-Sleep-only setup tapped again within a minute: nothing is wrong, nothing new is coming.
  if (garmin.state === "unavailable" && eight.state === "recent") {
    return NextResponse.json({ ok: true, recent: true, source: "eight_sleep", baseline: null, garmin: garmin.state, eightSleep: eight.state });
  }
  if (garmin.state !== "started" && eight.state !== "started") {
    console.error(`[wellness/sync-now] neither sidecar started (eight-sleep-sync: ${eight.error})`);
    return NextResponse.json({ ok: false, error: garmin.error }, { status: 502 });
  }
  const garminStarted = garmin.state === "started";
  return NextResponse.json({
    ok: true,
    source: garminStarted ? "garmin" : "eight_sleep",
    baseline: garminStarted ? garminBaseline : eightBaseline,
    // The other device's baseline, so the button can refresh when its data lands too.
    otherBaseline: garminStarted ? eightBaseline : garminBaseline,
    garmin: garmin.state,
    eightSleep: eight.state,
  });
}
