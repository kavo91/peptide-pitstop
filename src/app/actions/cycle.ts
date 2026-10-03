"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { planEndCycle, planNextCycle } from "@/lib/cycle/actions-plan";

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

  const { endDate, audit } = planEndCycle(protocol);

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
      newValue: audit,
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
 * column. Replaces a stale `endDate` (which would otherwise stop the schedule
 * resolver from generating doses for the new cycle) with the new cycle's
 * planned stop. The date maths live in lib/cycle/actions-plan.ts.
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

  const next = planNextCycle({ startDate: protocol.startDate, cycleOnWeeks: protocol.cycleOnWeeks }, new Date());

  await prisma.protocol.updateMany({
    where: { id: protocolId, userId: user.id },
    data: next.data,
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      entityType: "Protocol",
      entityId: protocolId,
      field: "cycle",
      oldValue: "off",
      newValue: next.audit,
    },
  });

  revalidatePath("/protocols");
  revalidatePath("/");
  revalidatePath("/today");
  return { ok: true as const };
}
