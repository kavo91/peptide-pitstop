"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { startOfDay, addDays } from "@/lib/schedule/schedule";
import { parseSchedule, weeklyDays } from "@/lib/schedule/entries";
import { rebaseWeek } from "@/lib/schedule/rebase";
import { appendIntervalAnchor } from "@/lib/schedule/interval-anchor";
import { dosesPerWeek } from "@/lib/schedule/frequency";
import { perInjectionDose } from "@/lib/titration/dose-basis";
import { doseDeltaMinutes } from "@/lib/planned/match";
import { runPlannedDoseGeneration } from "@/lib/planned/run";
import type { DoseUnit } from "@/lib/dosing/types";

/**
 * Persist a confirmed schedule change after an off-grid dose:
 *   weekly fixed_anchor → snap-back (shifted PlannedDose rows for this week);
 *   interval rolling    → catch-up roll (anchor appended inside scheduleRule,
 *                         future projections regenerated on the rolled grid).
 */
export async function confirmRebase(input: { protocolId: string; plannedDateISO: string; actualDateISO: string }) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const proto = await prisma.protocol.findFirst({ where: { id: input.protocolId, userId: user.id } });
  if (!proto?.scheduleRule) return { ok: false as const, error: "Protocol not found." };

  const schedule = parseSchedule(proto.scheduleRule);
  const wdays = weeklyDays(schedule);
  if (wdays.length === 0 && schedule.some((e) => e.dayPattern.kind === "interval")) {
    return confirmIntervalRoll(user.id, proto, input);
  }
  if (wdays.length === 0) return { ok: false as const, error: "Not a weekly schedule." };

  const actual = startOfDay(new Date(input.actualDateISO));
  const ws = addDays(actual, -actual.getDay());
  const shifted = rebaseWeek({
    rebaseMode: "fixed_anchor", freq: "WEEKLY", weekStart: ws, plannedDays: wdays,
    actual: { plannedDate: startOfDay(new Date(input.plannedDateISO)), actualDate: actual }, today: actual,
    endDate: proto.endDate,
  });
  if (shifted.length === 0) return { ok: true as const };

  // Persist the PER-INJECTION dose, never a raw per_week weekly value (spec §6).
  // Rebase rows are within-week weekly fixed_anchor shifts, so the titration
  // phase rarely changes inside the shifted week — the protocol-level
  // per-injection value is consistent with the other writers. When per_week
  // can't be divided (frequency unresolved) perInjectionDose returns null;
  // fall back to proto.targetDose ONLY for per_injection — for per_week write
  // null rather than persist an undivided weekly dose.
  const per = proto.targetDose != null
    ? perInjectionDose({
        doseBasis: proto.doseBasis === "per_week" ? "per_week" : "per_injection",
        value: proto.targetDose.toString(),
        unit: (proto.doseInputUnit as DoseUnit) ?? "mcg",
        injectionsPerWeek: dosesPerWeek(proto.scheduleRule),
      })
    : null;
  const rowTargetDose = per
    ? per.value
    : proto.doseBasis === "per_week"
      ? null
      : proto.targetDose;

  try {
    await prisma.$transaction(async (tx) => {
      const weekEnd = addDays(ws, 7);
      await tx.plannedDose.deleteMany({ where: { userId: user.id, protocolId: proto.id, status: "planned", scheduledAt: { gte: ws, lt: weekEnd } } });
      await tx.plannedDose.createMany({
        data: shifted.map((dte) => ({
          userId: user.id, protocolId: proto.id, scheduledAt: dte,
          targetDose: rowTargetDose, doseInputUnit: proto.doseInputUnit, status: "planned",
        })),
      });
    });
  } catch (e) {
    console.error("confirmRebase failed", e);
    return { ok: false as const, error: "Could not recalculate the schedule." };
  }
  revalidatePath("/doses");
  revalidatePath("/");
  return { ok: true as const };
}

/**
 * Catch-up roll for an every-N-days protocol: re-base the grid from the day
 * the dose was actually taken. The roll is stored as an anchor INSIDE
 * scheduleRule (append-only — see interval-anchor.ts), so past segments keep
 * their exact historical grids. Old-grid future projections are cleared and
 * regenerated on the rolled cadence, and the catch-up log is linked to the
 * new grid's day-0 row so the roll day can't be re-marked missed. The
 * originally missed day deliberately STAYS missed — the dose was skipped;
 * the display resolver matches by calendar day, so relabelling it "taken
 * late" would not render consistently anyway.
 */
async function confirmIntervalRoll(
  userId: string,
  proto: { id: string; scheduleRule: string | null; rebaseMode: string | null },
  input: { plannedDateISO: string; actualDateISO: string },
) {
  if ((proto.rebaseMode ?? "fixed_anchor") !== "rolling") {
    return { ok: false as const, error: "This protocol keeps a fixed schedule grid." };
  }
  const actual = startOfDay(new Date(input.actualDateISO));
  const newRule = appendIntervalAnchor(proto.scheduleRule, actual);
  if (!newRule) return { ok: false as const, error: "Not an interval schedule." };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.protocol.update({ where: { id: proto.id }, data: { scheduleRule: newRule } });
      // Old-grid projections after the roll would double-schedule alongside
      // the rolled grid — clear the unlogged ones; regeneration rebuilds.
      await tx.plannedDose.deleteMany({
        where: {
          userId,
          protocolId: proto.id,
          scheduledAt: { gt: actual },
          status: { in: ["planned", "missed"] },
          doseLog: { is: null },
        },
      });
    });
  } catch (e) {
    console.error("confirmIntervalRoll failed", e);
    return { ok: false as const, error: "Could not roll the schedule." };
  }
  await runPlannedDoseGeneration(userId);

  // The rolled grid's day 0 is the dose day itself — link the catch-up log to
  // the freshly generated row so tonight's tick can't mark the roll day missed.
  try {
    const dayZero = await prisma.plannedDose.findFirst({
      where: { userId, protocolId: proto.id, scheduledAt: actual, doseLog: { is: null } },
    });
    if (dayZero) {
      const log = await prisma.doseLog.findFirst({
        where: {
          userId,
          protocolId: proto.id,
          plannedDoseId: null,
          takenAt: { gte: actual, lt: addDays(actual, 1) },
        },
        orderBy: { takenAt: "desc" },
      });
      if (log) {
        await prisma.doseLog.update({
          where: { id: log.id },
          data: {
            plannedDoseId: dayZero.id,
            scheduledAt: dayZero.scheduledAt,
            deltaMinutes: doseDeltaMinutes(log.takenAt, dayZero.scheduledAt),
          },
        });
      }
    }
  } catch (e) {
    // Non-fatal: the roll itself is committed; an unlinked day-0 row only
    // costs a spurious "missed" mark that the user can see and delete.
    console.error("confirmIntervalRoll day-0 link failed", e);
  }
  revalidatePath("/doses");
  revalidatePath("/");
  revalidatePath("/today");
  return { ok: true as const };
}
