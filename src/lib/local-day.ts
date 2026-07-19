/**
 * Client-side stamp helpers for DoseLog.localDay / DoseLog.tz — the DEVICE's
 * calendar day and IANA zone at the moment a dose is logged. Pure and
 * environment-tolerant (deviceTimeZone degrades to null rather than throwing)
 * so the log forms can stamp unconditionally, including on LAN/HTTP where some
 * secure-context APIs are missing — Intl is not one of those, but we still
 * guard: a failed stamp must never block logging a dose.
 */

/** "YYYY-MM-DD" of `d` in the DEVICE's local timezone (getFullYear/Month/Date). */
export function localDayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The device's IANA timezone, or null when the runtime can't report one. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/**
 * `datetime-local` input value ("YYYY-MM-DDTHH:MM") for instant `d` in the
 * DEVICE zone. Edit forms re-render their server-built prefill through this on
 * mount so display zone == parse zone == stamp zone — the server builds the
 * prefill in the runtime TZ, but `new Date(value)` on save parses in the
 * device zone; without the re-render a touched edit made abroad would shift
 * the instant by the offset delta and mis-stamp localDay.
 */
export function toDeviceDatetimeLocal(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
