"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { startOfDay } from "@/lib/schedule/schedule";
import { cyclePlanEnd } from "@/lib/cycle/state";

/**
 * The two actions the cycle banner offers. Both are deliberately small and
 * reversible — everything they touch is editable from the protocol form, and
 * neither deletes or rewrites dose history.
 */

/**
 * End the cycle: mark the protocol `completed` and pin `endDate` to the last
 * planned dosing day (unless the user already set an earlier one).
 *
 * This is how a cycle alert is dismissed — the protocol stops being `active`,
 * so getCycleAlerts stops loading it. Reversible: set the status back to
 * `active` on the protocol form.
 */
export async function endCycle(protocolId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  const protocol = await prisma.protocol.findFirst({
    where: { id: protocolId, userId: user.id },
    select: { id: true, startDate: true, endDate: true, cycleAnchor: true, cycleOnWeeks: true },
  });
  if (!protocol) return { ok: false as const, error: "Protocol not found." };

  const plannedEnd = cyclePlanEnd(protocol.cycleAnchor ?? protocol.startDate, protocol.cycleOnWeeks);
  // Never PUSH an existing end date later — a user who already chose to finish
  // early meant it. Only fill a null, or pull an unset/later bound back in.
  const endDate =
    plannedEnd && (protocol.endDate === null || protocol.endDate > plannedEnd) ? plannedEnd : protocol.endDate;

  await prisma.protocol.updateMany({
    where: { id: protocolId, userId: user.id },
    data: { status: "completed", endDate },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      entityType: "Protocol",
      entityId: protocolId,
      field: "cycle",
      oldValue: "active",
      newValue: `cycle ended${endDate ? ` (endDate ${endDate.toISOString().slice(0, 10)})` : ""}`,
    },
  });

  revalidatePath("/protocols");
  revalidatePath("/");
  revalidatePath("/today");
  return { ok: true as const };
}

/**
 * Start the next cycle: move `cycleAnchor` to today and re-activate.
 *
 * The anchor moves rather than `startDate` so "when did I first start this
 * peptide" stays intact — the whole reason cycleAnchor exists as its own
 * column. Clears a stale `endDate` that would otherwise stop the schedule
 * resolver from generating doses for the new cycle.
 */
export async function startNextCycle(protocolId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  const protocol = await prisma.protocol.findFirst({
    where: { id: protocolId, userId: user.id },
    select: { id: true, cycleOnWeeks: true, startDate: true },
  });
  if (!protocol) return { ok: false as const, error: "Protocol not found." };
  if (!protocol.cycleOnWeeks) {
    return { ok: false as const, error: "This protocol has no cycle plan — set one on the protocol first." };
  }

  const today = startOfDay(new Date());
  const newEnd = cyclePlanEnd(today, protocol.cycleOnWeeks);

  await prisma.protocol.updateMany({
    where: { id: protocolId, userId: user.id },
    data: {
      cycleAnchor: today,
      status: "active",
      endDate: newEnd,
      // A protocol that never had a startDate gets one now, so day-N counters
      // and the titration resolver have an anchor for this cycle.
      ...(protocol.startDate ? {} : { startDate: today }),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      entityType: "Protocol",
      entityId: protocolId,
      field: "cycle",
      oldValue: "off",
      newValue: `next cycle started ${today.toISOString().slice(0, 10)}`,
    },
  });

  revalidatePath("/protocols");
  revalidatePath("/");
  revalidatePath("/today");
  return { ok: true as const };
}
