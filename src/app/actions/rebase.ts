"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { startOfDay, addDays } from "@/lib/schedule/schedule";
import { parseSchedule, weeklyDays } from "@/lib/schedule/entries";
import { rebaseWeek } from "@/lib/schedule/rebase";
import { dosesPerWeek } from "@/lib/schedule/frequency";
import { perInjectionDose } from "@/lib/titration/dose-basis";
import type { DoseUnit } from "@/lib/dosing/types";

/** Persist the confirmed snap-back: write shifted PlannedDose rows for this week. */
export async function confirmRebase(input: { protocolId: string; plannedDateISO: string; actualDateISO: string }) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const proto = await prisma.protocol.findFirst({ where: { id: input.protocolId, userId: user.id } });
  if (!proto?.scheduleRule) return { ok: false as const, error: "Protocol not found." };

  const wdays = weeklyDays(parseSchedule(proto.scheduleRule));
  if (wdays.length === 0) return { ok: false as const, error: "Not a weekly schedule." };

  const actual = startOfDay(new Date(input.actualDateISO));
  const ws = addDays(actual, -actual.getDay());
  const shifted = rebaseWeek({
    rebaseMode: "fixed_anchor", freq: "WEEKLY", weekStart: ws, plannedDays: wdays,
    actual: { plannedDate: startOfDay(new Date(input.plannedDateISO)), actualDate: actual }, today: actual,
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
