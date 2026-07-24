import "server-only";

/**
 * Viewer-timezone resolution for server components. The device's IANA zone is
 * mirrored into a cookie by ActiveRefresh (client); pages that answer "what day
 * is it for the person looking at the screen?" read it here instead of trusting
 * the container clock (pinned to Australia/Brisbane — correct at home, a day
 * off while travelling west of it in the evening).
 *
 * SCOPE: this re-anchors *which tracking day* the Today/dashboard views select
 * and label. A tracking day rolls at 02:00 in the viewer's phone timezone.
 * The planned-schedule grid, reminders and adherence stay anchored to the
 * runtime TZ (the schedule was authored in home time) — deliberately.
 */
import { cookies } from "next/headers";
import { trackingDayKeyInTz, isValidTimeZone, dayAnchor } from "./tz-day";
import { trackingDayOf } from "./local-day";
import { dayKey } from "./today-overrides";
import { TZ_COOKIE } from "./tz-cookie";

export { TZ_COOKIE };

/** The viewer's validated IANA zone, or null (no cookie / invalid value). */
export async function viewerTimeZone(): Promise<string | null> {
  const raw = (await cookies()).get(TZ_COOKIE)?.value;
  if (!raw) return null;
  let tz: string;
  try {
    tz = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return isValidTimeZone(tz) ? tz : null;
}

/**
 * The viewer's current tracking day plus a Date to feed day-keyed queries.
 *
 * `date` is the REAL current instant whenever the viewer's day coincides with
 * the server's (the at-home case) so time-relative maths downstream
 * (hoursSinceLast, overdue HH:MM compares) keeps its exact meaning; only when
 * the viewer's tracking day differs from the runtime calendar day (travel or
 * the midnight grace period) does it fall back to the noon anchor of the
 * viewer's day — day-correct, with clock-relative accuracy traded for it.
 */
export async function viewerToday(): Promise<{ key: string; date: Date }> {
  const now = new Date();
  const runtimeCalendarKey = dayKey(now);
  const serverKey = trackingDayOf(now);
  const tz = await viewerTimeZone();
  if (!tz) {
    return {
      key: serverKey,
      date: serverKey === runtimeCalendarKey ? now : dayAnchor(serverKey),
    };
  }
  const key = trackingDayKeyInTz(now, tz);
  return key === runtimeCalendarKey ? { key, date: now } : { key, date: dayAnchor(key) };
}
