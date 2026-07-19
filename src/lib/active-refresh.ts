/**
 * Pure decision logic for ActiveRefresh (the foreground data-refresh watchdog).
 * Split from the component so the throttle/rollover rules are unit-testable —
 * same pattern as version-heartbeat.ts.
 *
 * Why this exists: every data page is a force-dynamic server component, but a
 * resumed PWA (iOS keeps one alive for days) or a long-lived browser tab only
 * re-renders on navigation or an explicit router.refresh(). Logging a dose
 * refreshes (v1.3.3); the PASSAGE OF TIME never did — so a reopened app showed
 * a stale list, and after local midnight it still showed *yesterday*.
 */

/** Minimum gap between foreground-triggered refreshes (rapid app-switching guard). */
export const MIN_REFRESH_INTERVAL_MS = 15_000;

/** Throttle: refresh on foreground only when the last refresh is old enough. */
export function shouldRefreshOnActive(nowMs: number, lastRefreshMs: number, minIntervalMs = MIN_REFRESH_INTERVAL_MS): boolean {
  return nowMs - lastRefreshMs >= minIntervalMs;
}

/** True when the device-local calendar day has changed since the last render. */
export function dayRolled(prevDayKey: string, nowDayKey: string): boolean {
  return prevDayKey !== nowDayKey;
}
