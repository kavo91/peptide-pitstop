"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";

function posNum(v?: string | null): number | null {
  const n = Number((v ?? "").toString().trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface SyringeInput {
  id?: string;
  name: string;
  graduationType?: string; // units | ml
  deviceType?: string; // syringe | pen (presentation + wording only)
  unitsPerMl?: string;
  capacityMl?: string;
  capacityUnits?: string;
  increment?: string;
}

export async function saveSyringe(input: SyringeInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: "Name is required." };

  const unitsPerMl = posNum(input.unitsPerMl) ?? 100;
  const capacityMl = posNum(input.capacityMl);
  const capacityUnits = posNum(input.capacityUnits);
  const increment = posNum(input.increment);
  if (!capacityMl) return { ok: false as const, error: "Capacity (mL) must be positive." };
  if (!capacityUnits) return { ok: false as const, error: "Capacity (units) must be positive." };
  if (!increment) return { ok: false as const, error: "Increment must be positive." };

  const data = {
    name,
    graduationType: input.graduationType === "ml" ? "ml" : "units",
    deviceType: input.deviceType === "pen" ? "pen" : "syringe",
    unitsPerMl: Math.round(unitsPerMl),
    capacityMl: capacityMl.toString(),
    capacityUnits: Math.round(capacityUnits),
    increment: increment.toString(),
  };

  try {
    if (input.id) {
      const { count } = await prisma.syringe.updateMany({ where: { id: input.id, userId: user.id }, data });
      if (count === 0) return { ok: false as const, error: "Syringe not found." };
    } else {
      await prisma.syringe.create({ data: { ...data, userId: user.id } });
    }
  } catch (e) {
    console.error("saveSyringe failed", e);
    return { ok: false as const, error: "Could not save syringe." };
  }
  revalidatePath("/settings");
  revalidatePath("/log");
  return { ok: true as const };
}

/**
 * Set (or clear, with null) the user's preferred syringe/pen — preselected on
 * every log surface unless the protocol pins its own. Soft pointer on User;
 * only an own-or-shared device may be chosen.
 */
export async function setDefaultSyringe(syringeId: string | null) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  if (syringeId != null) {
    const s = await prisma.syringe.findFirst({ where: { id: syringeId, OR: [{ userId: user.id }, { userId: null }] } });
    if (!s) return { ok: false as const, error: "Syringe not found." };
  }
  try {
    await prisma.user.update({ where: { id: user.id }, data: { defaultSyringeId: syringeId } });
  } catch (e) {
    console.error("setDefaultSyringe failed", e);
    return { ok: false as const, error: "Could not set the default." };
  }
  revalidatePath("/settings");
  revalidatePath("/log");
  revalidatePath("/today");
  return { ok: true as const };
}

export async function deleteSyringe(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  try {
    const { count } = await prisma.syringe.deleteMany({ where: { id, userId: user.id } });
    if (count === 0) return { ok: false as const, error: "Syringe not found." };
    // A default pointing at a deleted device would silently fall back — clear
    // it so the pickers' behaviour is explicit.
    const u = await prisma.user.findUnique({ where: { id: user.id }, select: { defaultSyringeId: true } });
    if (u?.defaultSyringeId === id) {
      await prisma.user.update({ where: { id: user.id }, data: { defaultSyringeId: null } });
    }
  } catch (e) {
    // Most likely an FK constraint (syringe referenced by a logged dose).
    console.error("deleteSyringe failed", e);
    return { ok: false as const, error: "Could not delete — it may be linked to logged doses." };
  }
  revalidatePath("/settings");
  revalidatePath("/log");
  return { ok: true as const };
}
