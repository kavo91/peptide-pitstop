/**
 * Dose reminder notifications.
 *
 * Every 15 minutes (instrumentation tick + manual cron route) the app decides
 * which reminder EVENTS are due and pushes each one through the best channel:
 *   1. Web Push — the installed PWA's own notifications (tap opens the app).
 *   2. HA webhook — fallback relay to the phone via Home Assistant when the
 *      user has no Web Push subscription (or every send to them failed).
 *
 * Split into:
 *   - `buildReminderEvents` — a PURE, unit-tested planner over today's due
 *     doses (from `getTodayDoses`, the same authority as the Today page).
 *   - `sendDueReminders` / `runReminders` — impure: claim + dispatch.
 *
 * Event kinds:
 *   - SLOT reminder — one per (protocol, slot) per day. Timed slots fire
 *     around their own time (multi-time schedules get one per slot); untimed
 *     doses fire around UNTIMED_REMINDER_TIME.
 *   - NAG — one per day at NAG_TIME summarising every dose whose reminder
 *     moment has passed but is still unlogged.
 *
 * Exactly-once: each event is CLAIMED by inserting into ReminderSend, whose
 * unique (userId, dayKey, key) makes the insert the atomic claim — concurrent
 * ticks can never both push, and a claim is never re-sent even if the
 * downstream POST fails (never-double-send beats re-delivery).
 *
 * TZ: the container's TZ env must be YOUR local zone so Date maths is local.
 */

// ── Tuning ───────────────────────────────────────────────────────────────────
//
// An event is eligible from `GRACE` minutes before to `LOOKAHEAD` minutes after
// its moment. The grace window MUST be ≥ the tick interval (15 min, see
// instrumentation.ts) so an event can never slip *between* two ticks unnoticed.
export const REMINDER_GRACE_MINUTES = 30;
export const REMINDER_LOOKAHEAD_MINUTES = 30;

/**
 * Untimed (any-time-today) doses have no slot time to anchor a push, so they
 * remind at this DEFAULT local time — late enough to be awake, early enough
 * that the day's dose is still ahead. Timed slots always use their own time.
 * Overridable per user via Settings → Notifications (User.untimedReminderTime).
 */
export const UNTIMED_REMINDER_TIME = "08:00";

/**
 * Daily "still pending" nag — one summary push for unlogged past-moment doses.
 * DEFAULT anchor; per-user override + on/off in Settings (User.nagTime/nagEnabled).
 */
export const NAG_TIME = "18:00";

/** Per-user anchor overrides. Malformed times fall back to the defaults. */
export interface ReminderOptions {
  /** "HH:MM" anchor for untimed doses. Default UNTIMED_REMINDER_TIME. */
  untimedTime?: string;
  /** "HH:MM" nag anchor, or null to disable the nag. Default NAG_TIME. */
  nagTime?: string | null;
}

/** Well-formed 24h "HH:MM"? (Settings validates too — this is the belt-and-braces.) */
const validTime = (t: string | null | undefined): t is string =>
  typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/**
 * Minimal shape the pure planner needs — `DueDose` from lib/today satisfies it
 * structurally, so the impure caller reuses the SAME due-dose authority as the
 * Today page (start/end windows, overrides, rebases all already applied).
 * PlannedDose rows are stored at local MIDNIGHT (day-grain), so the row's
 * scheduledAt can NOT drive reminder timing — the live slot time here does.
 */
export interface SlotReminderCandidate {
  protocolId: string;
  peptideName: string;
  /** "HH:MM" slot time (local), or null for an untimed dose. */
  time: string | null;
  alreadyLoggedToday: boolean;
}

/**
 * One notification to deliver. SAFETY: never carries a dose amount — a raw
 * stored dose could be a multi-x overdose for per_week protocols.
 */
export interface ReminderEvent {
  /** Exactly-once claim key within (user, local day) — see ReminderSend. */
  key: string;
  title: string;
  body: string;
  /** Notification collapse tag — a repeat replaces rather than stacks. */
  tag: string;
  /** App path to open on tap (relative; senders absolutise where needed). */
  url: string;
}

/**
 * PURE — the local instant an event anchors to, on `day`'s date:
 * a slot's own time, or the untimed anchor (default UNTIMED_REMINDER_TIME).
 */
export function reminderMoment(day: Date, time: string | null, untimedTime: string = UNTIMED_REMINDER_TIME): Date {
  const anchor = time ?? (validTime(untimedTime) ? untimedTime : UNTIMED_REMINDER_TIME);
  const [h, m] = anchor.split(":").map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * PURE — the reminder events due at `now` for today's due doses:
 *
 *   - One SLOT event per (protocol, slot) whose moment is inside
 *     `[now − GRACE, now + lookaheadMinutes]` and isn't logged yet. Multi-time
 *     schedules produce one event per slot (distinct keys); the shared
 *     per-protocol tag means a later slot's notification replaces the stale
 *     earlier one on the phone.
 *   - One NAG event when NAG_TIME is inside the window and at least one dose
 *     whose moment has already passed (≤ the nag moment) is still unlogged.
 *     Future slots (e.g. a 20:00 dose) are excluded — they get their own slot
 *     reminder later.
 */
export function buildReminderEvents(
  dueDoses: readonly SlotReminderCandidate[],
  now: Date,
  lookaheadMinutes: number = REMINDER_LOOKAHEAD_MINUTES,
  opts: ReminderOptions = {},
): ReminderEvent[] {
  const untimedTime = validTime(opts.untimedTime) ? opts.untimedTime : UNTIMED_REMINDER_TIME;
  // null = nag OFF; undefined/malformed = default anchor.
  const nagAnchor =
    opts.nagTime === null ? null : validTime(opts.nagTime) ? opts.nagTime : NAG_TIME;

  const lower = now.getTime() - REMINDER_GRACE_MINUTES * 60_000;
  const upper = now.getTime() + lookaheadMinutes * 60_000;
  const inWindow = (t: number) => t >= lower && t <= upper;

  const events: ReminderEvent[] = [];
  const seen = new Set<string>();

  for (const d of dueDoses) {
    if (d.alreadyLoggedToday) continue;
    const key = `${d.protocolId}@${d.time ?? "untimed"}`;
    if (seen.has(key)) continue;
    if (!inWindow(reminderMoment(now, d.time, untimedTime).getTime())) continue;
    seen.add(key);
    events.push({
      key,
      title: `💉 ${d.peptideName} due`,
      body: d.time ? `Scheduled for ${d.time}.` : "Daily dose — not logged yet today.",
      tag: `peptide-${d.protocolId}`,
      url: "/today",
    });
  }

  const nagMoment = nagAnchor === null ? null : reminderMoment(now, nagAnchor).getTime();
  if (nagMoment !== null && inWindow(nagMoment)) {
    // Pending = still unlogged AND its moment has passed AT DELIVERY TIME —
    // `now`, not the nag anchor: a tick shortly before the anchor must not
    // describe a dose slotted at the anchor as "still pending" early (its own
    // slot reminder covers it). An empty pending set emits NO nag event, so
    // the once-per-day claim isn't spent and a later tick can nag correctly.
    const labels: string[] = [];
    const pendingProtocols = new Set<string>();
    for (const d of dueDoses) {
      if (d.alreadyLoggedToday) continue;
      if (reminderMoment(now, d.time, untimedTime).getTime() > now.getTime()) continue; // future slot — reminded later
      if (pendingProtocols.has(d.protocolId)) continue;
      pendingProtocols.add(d.protocolId);
      labels.push(d.time ? `${d.peptideName} (${d.time})` : d.peptideName);
    }
    if (labels.length > 0) {
      events.push({
        key: "nag",
        title: `⏰ ${labels.length} dose${labels.length === 1 ? "" : "s"} still pending`,
        body: `${labels.join(", ")} — not logged yet today.`,
        tag: "peptide-nag",
        url: "/today",
      });
    }
  }

  return events;
}

// ── Impure side ──────────────────────────────────────────────────────────────

/**
 * Absolute app origin for links sent to external relays (HA payload), or null
 * when PUBLIC_APP_URL is unset — then the payload omits `url` and the HA
 * automation's own default() fills the deep link instead.
 */
function publicAppUrl(): string | null {
  const url = (process.env.PUBLIC_APP_URL ?? "").trim();
  return url ? url.replace(/\/$/, "") : null;
}

/** Resolve the HA webhook URL, or null when unset (feature falls back / dormant). */
function getWebhookUrl(): string | null {
  const url = process.env.HA_WEBHOOK_URL;
  return url && url.trim() !== "" ? url : null;
}

let warnedNoChannel = false;

/** Generic relay body POSTed to HA — HA templates it straight into the phone push. */
export interface ReminderPayload {
  title: string;
  message: string;
  tag: string;
  /** Absolute deep link; omitted when PUBLIC_APP_URL is unset (HA default fills it). */
  url?: string;
}

/** POST the payload to HA with a short timeout so a hung HA never stalls the tick. */
async function postToHa(url: string, payload: ReminderPayload): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HA webhook returned ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send reminders for one user's due doses. Returns the number delivered.
 *
 * Channel preference per event: Web Push to every subscription the user has
 * (notifications come from the installed PWA and open it on tap); when the
 * user has no usable subscription — none registered, VAPID unconfigured, or
 * every send failed/pruned — fall back to the HA webhook relay. Claim BEFORE
 * dispatch: a claimed event is never retried (never-double-send by design).
 */
export async function sendDueReminders(
  userId: string,
  now: Date = new Date(),
  lookaheadMinutes: number = REMINDER_LOOKAHEAD_MINUTES,
): Promise<number> {
  const { getTodayDoses } = await import("@/lib/today");
  const { startOfDay } = await import("@/lib/schedule/schedule");
  const { dayKey } = await import("@/lib/today-overrides");
  const { prisma } = await import("@/lib/db");
  const { webPushAvailable, sendWebPush } = await import("@/lib/push");

  // Per-user anchors from Settings → Notifications; nagEnabled=false disables
  // the nag entirely (nagTime: null). Malformed values fall back to defaults.
  const prefs = await prisma.user.findUnique({
    where: { id: userId },
    select: { untimedReminderTime: true, nagTime: true, nagEnabled: true },
  });
  const events = buildReminderEvents(await getTodayDoses(userId, now), now, lookaheadMinutes, {
    untimedTime: prefs?.untimedReminderTime,
    nagTime: prefs && !prefs.nagEnabled ? null : prefs?.nagTime,
  });
  if (events.length === 0) return 0;

  const webhookUrl = getWebhookUrl();
  const webPush = await webPushAvailable(userId);
  if (!webPush && !webhookUrl) {
    // No channel at all: do NOT claim — enabling a channel later the same day
    // lets a still-in-window event deliver. Warn once per process.
    if (!warnedNoChannel) {
      console.log("[reminders] no push channel (no Web Push subscription, HA_WEBHOOK_URL unset) — dormant");
      warnedNoChannel = true;
    }
    return 0;
  }

  const day = dayKey(startOfDay(now));
  let sent = 0;
  for (const event of events) {
    // Atomic exactly-once claim: the unique (userId, dayKey, key) insert wins
    // or throws. Any failure (duplicate, DB down) skips the send — erring on
    // "never double" — so no push can ever fire twice for one event.
    try {
      await prisma.reminderSend.create({
        data: { userId, dayKey: day, key: event.key, channel: webPush ? "webpush" : "ha" },
      });
    } catch {
      continue;
    }

    try {
      let delivered = 0;
      if (webPush) delivered = await sendWebPush(userId, event);
      if (delivered === 0 && webhookUrl) {
        const base = publicAppUrl();
        await postToHa(webhookUrl, {
          title: event.title,
          message: event.body,
          tag: event.tag,
          ...(base ? { url: `${base}${event.url}` } : {}),
        });
        delivered = 1;
      }
      if (delivered > 0) sent++;
      else console.error(`[reminders] no channel delivered "${event.key}" (claimed, not retried)`);
    } catch (err) {
      // Fail-safe: a down channel must never crash the tick. Claim stands (no retry).
      console.error(`[reminders] failed to push "${event.key}":`, err);
    }
  }
  return sent;
}

/**
 * Run reminders for every user with an active protocol. Used by both the cron
 * route and the instrumentation interval.
 */
export async function runReminders(
  now: Date = new Date(),
  lookaheadMinutes: number = REMINDER_LOOKAHEAD_MINUTES,
): Promise<{ sent: number }> {
  const { prisma } = await import("@/lib/db");
  const users = await prisma.user.findMany({
    where: { protocols: { some: { status: "active" } } },
    select: { id: true },
  });

  let sent = 0;
  for (const user of users) {
    sent += await sendDueReminders(user.id, now, lookaheadMinutes);
  }
  return { sent };
}
