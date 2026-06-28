/**
 * HA push reminders (Work-stream 2).
 *
 * When a scheduled dose is due soon, push a notification to Home Assistant
 * (which relays it to your phone) exactly once per dose.
 *
 * Split into:
 *   - `dueReminders` — a PURE, unit-tested predicate over candidate doses.
 *   - `sendDueReminders` / `runReminders` — impure: load candidates, POST to
 *     `HA_WEBHOOK_URL`, and stamp `reminderSentAt` idempotently.
 *
 * TZ: the container runs Australia/Brisbane, so the stored `Date`s and `now`
 * compare correctly in local time — no offset maths needed (just `Date` vs `now`).
 */

// ── Tuning ───────────────────────────────────────────────────────────────────
//
// A dose is eligible from `GRACE` minutes before to `LOOKAHEAD` minutes after the
// current tick. The grace window MUST be ≥ the tick interval (15 min, see
// instrumentation.ts) so a dose can never slip *between* two ticks unnoticed; it
// also lets the startup catch-up tick pick up a dose that just became due. 30 min
// each gives ~1 h of combined coverage — robust even if a single tick is skipped.
export const REMINDER_GRACE_MINUTES = 30;
export const REMINDER_LOOKAHEAD_MINUTES = 30;

/** Minimal shape the pure finder needs — richer objects pass through unchanged. */
export interface ReminderCandidate {
  scheduledAt: Date;
  status: string;
  reminderSentAt: Date | null;
}

/** Notification body POSTed to HA. SAFETY: peptide + local time + protocolId ONLY. */
export interface ReminderPayload {
  /** Peptide display name. */
  peptide: string;
  /** Scheduled local time, "HH:MM". */
  time: string;
  /** Protocol the dose belongs to (lets the HA side deep-link / dedup). */
  protocolId: string;
}

/**
 * PURE — the subset of `candidates` that should be reminded at `now`:
 *   - `status === "planned"`,
 *   - `reminderSentAt == null`,
 *   - `scheduledAt` within `[now - GRACE, now + lookaheadMinutes]` (inclusive).
 *
 * Generic so the impure caller gets its own (peptide-bearing) rows back, typed.
 */
export function dueReminders<T extends ReminderCandidate>(
  candidates: readonly T[],
  now: Date,
  lookaheadMinutes: number,
): T[] {
  const lower = now.getTime() - REMINDER_GRACE_MINUTES * 60_000;
  const upper = now.getTime() + lookaheadMinutes * 60_000;
  return candidates.filter((c) => {
    if (c.status !== "planned") return false;
    if (c.reminderSentAt != null) return false;
    const t = c.scheduledAt.getTime();
    return t >= lower && t <= upper;
  });
}

// ── Impure side ──────────────────────────────────────────────────────────────

let warnedNoWebhook = false;

/** Resolve the HA webhook URL; log ONCE per process when it is unset/empty. */
function getWebhookUrl(): string | null {
  const url = process.env.HA_WEBHOOK_URL;
  if (!url || url.trim() === "") {
    if (!warnedNoWebhook) {
      console.log("[reminders] HA_WEBHOOK_URL not set — push reminders dormant");
      warnedNoWebhook = true;
    }
    return null;
  }
  return url;
}

/** Local "HH:MM" of a Date (container TZ = Australia/Brisbane). */
function localHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
 * Send reminders for one user's due planned doses. Returns the number sent.
 *
 * No-double-send guarantee: each dose is *claimed* with an atomic
 * `updateMany({ where: { reminderSentAt: null, ... }, data: { reminderSentAt } })`.
 * Only the caller whose update flips the row from null wins (`count === 1`), so two
 * concurrent ticks (15-min interval + the manual cron route) can never both push.
 * We claim BEFORE posting: if the HA POST then fails the dose stays stamped and is
 * not retried — a deliberate trade favouring "never double-send" over re-delivery.
 */
export async function sendDueReminders(
  userId: string,
  now: Date = new Date(),
  lookaheadMinutes: number = REMINDER_LOOKAHEAD_MINUTES,
): Promise<number> {
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) return 0;

  const { prisma } = await import("@/lib/db");

  const lowerBound = new Date(now.getTime() - REMINDER_GRACE_MINUTES * 60_000);
  const upperBound = new Date(now.getTime() + lookaheadMinutes * 60_000);

  // Narrow at the DB layer; the pure finder is then the source of truth.
  const candidates = await prisma.plannedDose.findMany({
    where: {
      userId,
      status: "planned",
      reminderSentAt: null,
      scheduledAt: { gte: lowerBound, lte: upperBound },
      protocol: { status: "active" },
    },
    select: {
      id: true,
      protocolId: true,
      scheduledAt: true,
      status: true,
      reminderSentAt: true,
      protocol: { select: { peptide: { select: { name: true } } } },
    },
  });

  const due = dueReminders(candidates, now, lookaheadMinutes);

  let sent = 0;
  for (const dose of due) {
    // Atomic claim — concurrent ticks can't both win this row.
    const claim = await prisma.plannedDose.updateMany({
      where: { id: dose.id, reminderSentAt: null, status: "planned" },
      data: { reminderSentAt: now },
    });
    if (claim.count !== 1) continue; // already claimed by another tick

    const payload: ReminderPayload = {
      peptide: dose.protocol?.peptide?.name ?? "Peptide",
      time: localHHMM(dose.scheduledAt),
      protocolId: dose.protocolId,
    };

    try {
      await postToHa(webhookUrl, payload);
      sent++;
    } catch (err) {
      // Fail-safe: HA down must never crash the tick. Row stays stamped (no retry).
      console.error(`[reminders] failed to push reminder for dose ${dose.id}:`, err);
    }
  }
  return sent;
}

/**
 * Run reminders for every user with an active protocol. Used by both the cron
 * route and the instrumentation interval. No-op (logged once) if HA_WEBHOOK_URL
 * is unset.
 */
export async function runReminders(
  now: Date = new Date(),
  lookaheadMinutes: number = REMINDER_LOOKAHEAD_MINUTES,
): Promise<{ sent: number }> {
  if (!getWebhookUrl()) return { sent: 0 };

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
