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

export async function deleteSyringe(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  try {
    const { count } = await prisma.syringe.deleteMany({ where: { id, userId: user.id } });
    if (count === 0) return { ok: false as const, error: "Syringe not found." };
  } catch (e) {
    // Most likely an FK constraint (syringe referenced by a logged dose).
    console.error("deleteSyringe failed", e);
    return { ok: false as const, error: "Could not delete — it may be linked to logged doses." };
  }
  revalidatePath("/settings");
  revalidatePath("/log");
  return { ok: true as const };
}
