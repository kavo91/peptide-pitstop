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

/** Well-formed 24h "HH:MM" or null. */
function optTime(v?: string | null): string | null {
  const s = (v ?? "").toString().trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : null;
}

/**
 * Update reminder anchors (Settings → Notifications): the untimed-dose
 * reminder time, the still-pending nag time, and the nag on/off switch.
 * Defaults 08:00 / 18:00 / on. Times must be 24h "HH:MM"; invalid input is
 * rejected rather than silently defaulted so a typo can't move a reminder.
 */
export async function updateReminderSettings(input: {
  untimedTime?: string;
  nagTime?: string;
  nagEnabled?: boolean;
}) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  const untimedTime = optTime(input.untimedTime);
  if (!untimedTime) return { ok: false as const, error: "Daily reminder time must be HH:MM (24h)." };
  const nagEnabled = input.nagEnabled !== false;
  // Only require a valid nag time while the nag is ON — a disabled nag keeps
  // its stored time so re-enabling restores the previous anchor.
  const nagTime = optTime(input.nagTime);
  if (nagEnabled && !nagTime) return { ok: false as const, error: "Nag time must be HH:MM (24h)." };

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        untimedReminderTime: untimedTime,
        nagEnabled,
        ...(nagTime ? { nagTime } : {}),
      },
    });
  } catch (e) {
    console.error("updateReminderSettings failed", e);
    return { ok: false as const, error: "Could not save reminder settings." };
  }
  revalidatePath("/settings");
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
