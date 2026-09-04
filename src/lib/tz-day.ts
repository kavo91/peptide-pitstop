/**
 * Pure IANA-timezone day/time helpers — no I/O, no cookie access (that lives in
 * viewer-tz.ts). These exist because DoseLog day-bucketing must be computable in
 * a timezone OTHER than the runtime TZ: the container is pinned to
 * Australia/Brisbane (see instrumentation.ts), but a dose logged while
 * travelling belongs to the calendar day of the DEVICE that logged it.
 */

/** "YYYY-MM-DD" format for a client-stamped DoseLog.localDay. */
export const LOCAL_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Peptide Pitstop's tracking day rolls at 02:00, not midnight. This gives
 * late-night doses a two-hour phone-local grace period: 00:00–01:59 belongs
 * to the preceding tracking day; 02:00 starts the new one.
 */
export const TRACKING_DAY_ROLLOVER_HOUR = 2;

/**
 * True when `tz` is an IANA zone the runtime's Intl accepts. The pre-check
 * regex bounds length/charset so an arbitrary cookie value can't reach Intl
 * with junk (Intl throws RangeError on unknown zones — caught here).
 */
export function isValidTimeZone(tz: string): boolean {
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Calendar-day key "YYYY-MM-DD" of instant `d` in IANA zone `tz` (en-CA locale = ISO date order). */
export function dayKeyInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Wall-clock "HH:MM" (24h) of instant `d` in IANA zone `tz`. */
export function timeInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/** The ISO calendar day immediately before `key`. */
export function previousDayKey(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/**
 * Tracking-day key for instant `d` in the PHONE's IANA timezone. The instant
 * remains unchanged; only its day bucket rolls back during the 00:00–01:59
 * grace period.
 */
export function trackingDayKeyInTz(d: Date, tz: string): string {
  const calendarDay = dayKeyInTz(d, tz);
  const rollover = `${String(TRACKING_DAY_ROLLOVER_HOUR).padStart(2, "0")}:00`;
  return timeInTz(d, tz) < rollover ? previousDayKey(calendarDay) : calendarDay;
}

/**
 * A runtime-TZ Date that is unambiguously ON calendar day `key`: local noon.
 * Noon (not midnight) so a ±1 h DST shift can never tip the instant across a
 * day boundary. Used to feed day-keyed views (getTodayDoses et al.) a Date that
 * `startOfDay` resolves back to `key`.
 */
export function dayAnchor(key: string): Date {
  return new Date(`${key}T12:00:00`);
}

/**
 * How far a client-stamped localDay's anchor may sit from the dose's takenAt
 * instant. The legitimate maximum is ~38 h (UTC+14 device vs UTC-12 runtime,
 * plus the noon anchor offset); 48 h gives slack while blocking absurd
 * relabelling ("0001-01-01") that would make a row invisible in every view.
 */
const LOCAL_DAY_MAX_SKEW_MS = 48 * 3_600_000;

/**
 * Validate an untrusted { localDay, tz } pair from a client (log/edit input).
 * Returns nulls for anything malformed rather than throwing — a legacy or
 * tampered client degrades to the pre-timezone behaviour (server-TZ bucketing),
 * never to a crash or a junk row. When `nearInstant` (the dose's takenAt) is
 * given, a well-formed but implausibly distant localDay is also rejected.
 */
export function sanitizeLocalDayTz(
  input: { localDay?: unknown; tz?: unknown },
  nearInstant?: Date,
): {
  localDay: string | null;
  tz: string | null;
} {
  // typeof guards first: RegExp.test and Intl both COERCE arrays/objects to
  // strings, so ["2026-07-18"] would otherwise pass and then blow up Prisma's
  // String-column validation — aborting the dose write the sanitiser exists
  // to protect.
  let localDay =
    typeof input.localDay === "string" && LOCAL_DAY_RE.test(input.localDay) ? input.localDay : null;
  const tz = typeof input.tz === "string" && isValidTimeZone(input.tz) ? input.tz : null;
  if (localDay) {
    // Component round-trip through the anchor: month 00/13 parses to NaN, but
    // V8 ROLLS grammar-valid day overflow ("2026-02-30" → Mar 2), producing a
    // key no dayKey()/dayKeyInTz() can ever emit — the row would be invisible
    // in every view. Reject unless the anchor reads back the exact Y-M-D.
    const anchor = dayAnchor(localDay);
    const [y, m, d] = localDay.split("-").map(Number);
    const roundTrips =
      !Number.isNaN(anchor.getTime()) &&
      anchor.getFullYear() === y &&
      anchor.getMonth() + 1 === m &&
      anchor.getDate() === d;
    const plausible =
      roundTrips &&
      (!nearInstant || Math.abs(anchor.getTime() - nearInstant.getTime()) <= LOCAL_DAY_MAX_SKEW_MS);
    if (!plausible) localDay = null;
  }
  return { localDay, tz };
}

/**
 * Resolve the authoritative tracking-day stamp for a dose write. A valid
 * phone timezone wins: the server derives the day from the real takenAt
 * instant and the shared 02:00 rule instead of trusting a possibly stale
 * client day. Legacy clients without a usable timezone retain the sanitized
 * localDay fallback.
 */
export function resolveTrackingDayStamp(
  input: { localDay?: unknown; tz?: unknown },
  takenAt: Date,
): {
  localDay: string | null;
  tz: string | null;
} {
  const sanitized = sanitizeLocalDayTz(input, takenAt);
  if (!sanitized.tz || Number.isNaN(takenAt.getTime())) return sanitized;
  return {
    localDay: trackingDayKeyInTz(takenAt, sanitized.tz),
    tz: sanitized.tz,
  };
}

/**
 * Locale time label ("10:09 PM" under the container's en-US ICU default) in
 * the dose's own zone when stamped, the runtime zone otherwise — ONE format
 * for both, so stamped and legacy rows never mix 12h/24h in the same list.
 * Falls back to the runtime zone if a stored tz is ever rejected by the
 * runtime's ICU (defence-in-depth: tz was Intl-validated at write time, but
 * ICU data can change across upgrades and one bad row must not 500 the page).
 */
export function localeTimeLabel(d: Date, tz: string | null): string {
  try {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZone: tz ?? undefined });
  } catch {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
}

/** The wall-clock parts of instant `d` as read in zone `tz`, as a UTC epoch. */
function wallClockEpoch(d: Date, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => Number(p.find((x) => x.type === type)?.value ?? "0");
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/**
 * The instant at which the clock in zone `tz` reads the given wall-clock time.
 *
 * A printed report states a local time and no offset — this is what turns
 * "12 June 2024 @ 9:17 AM" plus a zone into a storable instant.
 *
 * Two passes: the first finds the zone's offset near the guess, the second
 * re-reads it at the corrected instant, which is what makes the hour either
 * side of a DST change land correctly.
 *
 * A wall-clock time that a spring-forward SKIPS has no instant at all. This
 * settles such a value on the moment one offset-step before the gap — the
 * instant the clock last showed before jumping over it. That case cannot arise
 * from a report, which prints a time that was actually observed; it is defined
 * here only so the function is total.
 */
export function zonedWallClockToInstant(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  tz: string,
): Date {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let instant = target;
  for (let pass = 0; pass < 2; pass++) {
    instant = target - (wallClockEpoch(new Date(instant), tz) - instant);
  }
  return new Date(instant);
}
