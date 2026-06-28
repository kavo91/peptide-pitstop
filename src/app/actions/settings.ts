"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { serializeSymptomList } from "@/lib/side-effects";

function optInt(v?: string | null): number | null {
  const s = (v ?? "").toString().trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function updateReorderDefaults(input: { leadTimeDays?: string; bufferDays?: string }) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  try {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        reorderLeadTimeDays: optInt(input.leadTimeDays) ?? 14,
        reorderBufferDays: optInt(input.bufferDays) ?? 3,
      },
    });
  } catch (e) {
    console.error("updateReorderDefaults failed", e);
    return { ok: false as const, error: "Could not save settings." };
  }
  revalidatePath("/settings");
  revalidatePath("/inventory");
  revalidatePath("/more");
  return { ok: true as const };
}

/**
 * Update wellness preferences: the daily hydration target (mL; blank → cleared)
 * and the custom side-effect symptom list (comma/newline separated; blank → clears
 * the override so the curated default applies).
 */
export async function updateWellnessSettings(input: { hydrationTargetMl?: string; symptomList?: string }) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  try {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        hydrationTargetMl: optInt(input.hydrationTargetMl),
        symptomList: serializeSymptomList(input.symptomList),
      },
    });
  } catch (e) {
    console.error("updateWellnessSettings failed", e);
    return { ok: false as const, error: "Could not save wellness settings." };
  }
  revalidatePath("/settings");
  revalidatePath("/journal");
  return { ok: true as const };
}
