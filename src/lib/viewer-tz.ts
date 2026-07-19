import "server-only";

/**
 * Viewer-timezone resolution for server components. The device's IANA zone is
 * mirrored into a cookie by ActiveRefresh (client); pages that answer "what day
 * is it for the person looking at the screen?" read it here instead of trusting
 * the container clock (pinned to Australia/Brisbane — correct at home, a day
 * off while travelling west of it in the evening).
 *
 * SCOPE: this re-anchors *which calendar day* the Today/dashboard views select
 * and label. The planned-schedule grid, reminders and adherence stay anchored
 * to the runtime TZ (the schedule was authored in home time) — deliberately.
 */
import { cookies } from "next/headers";
import { dayKeyInTz, isValidTimeZone, dayAnchor } from "./tz-day";
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
 * The viewer's current calendar day plus a Date to feed day-keyed queries.
 *
 * `date` is the REAL current instant whenever the viewer's day coincides with
 * the server's (the at-home case) so time-relative maths downstream
 * (hoursSinceLast, overdue HH:MM compares) keeps its exact meaning; only when
 * the viewer's calendar day differs (travelling across the date boundary) does
 * it fall back to the noon anchor of the viewer's day — day-correct, with
 * clock-relative accuracy traded for it.
 */
export async function viewerToday(): Promise<{ key: string; date: Date }> {
  const now = new Date();
  const serverKey = dayKey(now);
  const tz = await viewerTimeZone();
  if (!tz) return { key: serverKey, date: now };
  const key = dayKeyInTz(now, tz);
  return key === serverKey ? { key, date: now } : { key, date: dayAnchor(key) };
}
