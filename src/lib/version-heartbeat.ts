/**
 * Reload decision for the PWA version heartbeat. iOS keeps installed PWAs
 * resumed for days without a navigation, so deployed bundles never load until
 * something forces a reload — the heartbeat compares the running bundle's
 * APP_VERSION against /api/version and reloads at most once per served
 * version (guarding against a reload loop if a cache keeps serving old HTML).
 */
export function shouldReloadForVersion(
  running: string,
  served: unknown,
  lastReloadedFor: string | null,
): boolean {
  if (typeof served !== "string" || served.length === 0) return false;
  if (served === running) return false;
  if (served === lastReloadedFor) return false;
  return true;
}
