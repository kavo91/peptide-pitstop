/**
 * Status text for the "Sync now" button, from /api/wellness/sync-now's answer.
 * Pure. Names only the devices whose pull actually started, so Garmin-only,
 * Eight-Sleep-only and both read correctly. A device that is simply not set up
 * ("unavailable") is never mentioned; one that refused ("failed") is.
 */
type KickState = "started" | "failed" | "unavailable" | "recent";

export interface SyncNowStarted {
  source?: "garmin" | "eight_sleep";
  garmin?: KickState;
  eightSleep?: KickState;
}

export interface SyncNowMessages {
  /** `source` query value for /api/wellness/sync-status. */
  source: "garmin" | "eight_sleep";
  /** The other device to watch for a quiet refresh, when its pull started too. */
  other: "garmin" | "eight_sleep" | null;
  waiting: string;
  slow: string;
  /** Appended to "Synced…" — a device that refused, or "" when nothing did. */
  doneNote: string;
}

export function syncNowMessages(r: SyncNowStarted): SyncNowMessages {
  const source = r.source === "eight_sleep" ? "eight_sleep" : "garmin";
  const garmin = source === "garmin";
  const eightStarted = r.eightSleep === "started";
  const devices = garmin && eightStarted ? "Garmin and Eight Sleep" : garmin ? "Garmin" : "Eight Sleep";
  const note = !garmin && r.garmin === "failed" ? " · Garmin did not start" : garmin && r.eightSleep === "failed" ? " · Eight Sleep did not start" : "";
  return {
    source,
    other: garmin && eightStarted ? "eight_sleep" : null,
    waiting: `Getting your latest ${devices} data${note}`,
    slow: `${garmin ? "Garmin" : "Eight Sleep"} is still working. New data will show the next time you open this page${note}`,
    doneNote: note,
  };
}
