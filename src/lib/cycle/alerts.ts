/**
 * Cycle ALERTS — the one place that decides what a cycle plan should say, and
 * how loudly, on any given day.
 *
 * Feeds two surfaces from a single derivation so they can never disagree:
 *   - the dashboard / today CycleBanner (via {@link bannerAlerts})
 *   - the push + HA reminder channel   (via {@link cycleNotifications})
 *
 * SAFETY, mirroring ../reminders.ts: alert text NEVER carries a dose amount. A
 * raw stored dose can be a whole week's total on a `per_week` protocol, and a
 * notification is exactly the place someone acts on a number without checking.
 *
 * PURE — no I/O. Dates go through ./format, whose fixed month table keeps the
 * strings byte-identical on server, client and every Node/ICU build.
 */
import { cycleState, type CycleState } from "./state";
import { fmtCycleDay } from "./format";

/** The minimum a protocol must expose for its cycle to be evaluated. */
export interface CycleProtocol {
  id: string;
  peptideName: string;
  /** Protocol.cycleAnchor ?? Protocol.startDate. */
  anchor: Date | null;
  onWeeks: number | null;
  offWeeks: number | null;
  /** Protocol.status — only `active` protocols raise alerts. */
  status: string;
}

export type CycleAlertKind =
  | "ending_soon"
  | "last_dose"
  | "stop_now"
  | "off_cycle"
  | "restart_soon"
  | "restart_now";

/** info = ambient context; warn = act soon; action = act today. */
export type CycleAlertLevel = "info" | "warn" | "action";

export interface CycleAlert {
  protocolId: string;
  peptideName: string;
  kind: CycleAlertKind;
  level: CycleAlertLevel;
  title: string;
  body: string;
  /** Days left in the current phase, including today. 0 once the cycle ended. */
  daysRemaining: number;
  state: CycleState;
}

/** How many days before a phase boundary the UI starts warning. */
export const CYCLE_WARN_DAYS = 7;

/**
 * Days-remaining values that earn a PUSH (as opposed to a banner). Deliberately
 * sparse: the banner is always-on and free, a notification is an interruption,
 * so a countdown only interrupts twice before the day itself.
 */
const NOTIFY_AT_DAYS = [7, 3];

const LEVEL_RANK: Record<CycleAlertLevel, number> = { action: 0, warn: 1, info: 2 };

/**
 * Every cycle alert live on `today`, most urgent first.
 *
 * Silence is the default: a protocol mid-cycle with nothing approaching emits
 * nothing at all. Non-active protocols never emit — marking a protocol
 * completed or paused is exactly how the user dismisses a cycle alert.
 */
export function cycleAlerts(
  protocols: readonly CycleProtocol[],
  today: Date,
  opts: { warnDays?: number } = {},
): CycleAlert[] {
  const warnDays = opts.warnDays ?? CYCLE_WARN_DAYS;
  const out: CycleAlert[] = [];

  for (const p of protocols) {
    if (p.status !== "active") continue;
    const state = cycleState({ anchor: p.anchor, onWeeks: p.onWeeks, offWeeks: p.offWeeks, today });
    if (!state) continue;

    const base = { protocolId: p.id, peptideName: p.peptideName, state };
    const endLabel = fmtCycleDay(state.onCycleEndsOn);

    if (state.phase === "on") {
      // A restart outranks a countdown: on day 1 of cycle 2+ the useful message
      // is "start again today", not "56 days to go".
      if (state.dayOfPhase === 1 && state.cycleNumber > 1) {
        out.push({
          ...base,
          kind: "restart_now",
          level: "action",
          title: `${p.peptideName} — back on today`,
          body: `Break over. Cycle ${state.cycleNumber} starts today and runs to ${endLabel}.`,
          daysRemaining: state.daysRemaining,
        });
        continue;
      }
      if (state.daysRemaining === 1) {
        out.push({
          ...base,
          kind: "last_dose",
          level: "action",
          title: `${p.peptideName} — last dose of the cycle`,
          body: `Today (${endLabel}) is the final day of this ${state.phaseDays / 7}-week cycle.`,
          daysRemaining: 1,
        });
        continue;
      }
      if (state.daysRemaining <= warnDays) {
        out.push({
          ...base,
          kind: "ending_soon",
          level: "warn",
          title: `${p.peptideName} — cycle ends in ${state.daysRemaining} days`,
          body: `Day ${state.dayOfPhase} of ${state.phaseDays}. Planned last dose ${endLabel}.`,
          daysRemaining: state.daysRemaining,
        });
      }
      continue;
    }

    if (state.phase === "ended") {
      // Still `active` past its planned stop — a real discrepancy, so this is
      // never silently dropped. It de-escalates after a week rather than
      // shouting indefinitely; marking the protocol completed clears it.
      out.push({
        ...base,
        kind: "stop_now",
        level: state.dayOfPhase <= 7 ? "action" : "warn",
        title: `${p.peptideName} — cycle complete`,
        body:
          state.dayOfPhase === 1
            ? `Planned cycle finished ${endLabel}. Stop dosing and mark the protocol completed.`
            : `Planned cycle finished ${endLabel} (${state.dayOfPhase - 1} days ago) but the protocol is still active.`,
        daysRemaining: 0,
      });
      continue;
    }

    // phase === "off": a planned break with a known restart.
    const restart = state.nextPhaseStartsOn;
    const restartLabel = restart ? fmtCycleDay(restart) : "—";
    if (state.daysRemaining <= warnDays) {
      out.push({
        ...base,
        kind: "restart_soon",
        level: "warn",
        title: `${p.peptideName} — restart in ${state.daysRemaining} days`,
        body: `Break ends ${restartLabel}; cycle ${state.cycleNumber + 1} starts then.`,
        daysRemaining: state.daysRemaining,
      });
    } else {
      out.push({
        ...base,
        kind: "off_cycle",
        level: "info",
        title: `${p.peptideName} — off cycle`,
        body: `Day ${state.dayOfPhase} of a ${state.phaseDays / 7}-week break. Restart ${restartLabel}.`,
        daysRemaining: state.daysRemaining,
      });
    }
  }

  return out.sort(
    (a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.daysRemaining - b.daysRemaining,
  );
}

/** The alerts worth a banner — ambient off-cycle status stays off the dashboard. */
export function bannerAlerts(alerts: readonly CycleAlert[]): CycleAlert[] {
  return alerts.filter((a) => a.level !== "info");
}

/** A notification, shaped to match lib/reminders' ReminderEvent exactly. */
export interface CycleNotification {
  key: string;
  title: string;
  body: string;
  tag: string;
  url: string;
}

/**
 * The subset of alerts that earn a PUSH today.
 *
 * Boundary days always fire (last dose, cycle over, restart). Countdowns fire
 * only at {@link NOTIFY_AT_DAYS} — the banner carries every other day, so the
 * phone is interrupted a handful of times per cycle rather than daily.
 *
 * Keys are stable per (protocol, kind); ReminderSend's unique
 * (userId, dayKey, key) makes the insert the once-per-day claim.
 */
export function cycleNotifications(alerts: readonly CycleAlert[]): CycleNotification[] {
  const out: CycleNotification[] = [];
  for (const a of alerts) {
    const fires =
      a.kind === "last_dose" ||
      a.kind === "restart_now" ||
      (a.kind === "stop_now" && a.state.dayOfPhase === 1) ||
      ((a.kind === "ending_soon" || a.kind === "restart_soon") &&
        NOTIFY_AT_DAYS.includes(a.daysRemaining));
    if (!fires) continue;
    out.push({
      key: `cycle:${a.protocolId}:${a.kind}`,
      title: `🔄 ${a.title}`,
      body: a.body,
      tag: `cycle-${a.protocolId}`,
      url: "/protocols",
    });
  }
  return out;
}
