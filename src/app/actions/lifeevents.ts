"use server";

/**
 * Illness / travel / other windows (`LifeEvent`). A window shades every chart,
 * its days are excluded from interval medians and counted — it never explains a
 * change. `label` is short plaintext; `notes` is ENCRYPTED at rest.
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { encryptField } from "@/lib/crypto/fieldEncryption";
import { LOCAL_DAY_RE } from "@/lib/tz-day";

export type LifeEventKind = "illness" | "travel" | "other";

export interface CreateLifeEventInput {
  kind: LifeEventKind;
  /** YYYY-MM-DD (local). */
  startDay: string;
  /** YYYY-MM-DD (local), inclusive; must be ≥ startDay. */
  endDay: string;
  label?: string;
  notes?: string;
}

export interface LifeEventResult { ok: boolean; id?: string; error?: string }

const KINDS = new Set<string>(["illness", "travel", "other"]);
/** Longest window accepted, counted as inclusive calendar days (≤ 120 days). */
const MAX_WINDOW_DAYS = 120;
const MAX_LABEL_CHARS = 60;
const DAY = 86_400_000;

/** Valid calendar day in YYYY-MM-DD form (rejects 2026-02-31 and the like). */
function parseDay(v: string | undefined | null, label: string): string {
  const s = (v ?? "").trim();
  if (!LOCAL_DAY_RE.test(s)) throw new Error(`${label} must be a date (YYYY-MM-DD).`);
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) throw new Error(`${label} is not a real calendar day.`);
  return s;
}

export async function createLifeEvent(input: CreateLifeEventInput): Promise<LifeEventResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  let kind: LifeEventKind, startDay: string, endDay: string;
  try {
    if (!KINDS.has(input.kind)) throw new Error("Kind must be illness, travel or other.");
    kind = input.kind;
    startDay = parseDay(input.startDay, "Start day");
    endDay = parseDay(input.endDay, "End day");
    if (endDay < startDay) throw new Error("End day must be on or after the start day.");
    const spanDays = Math.round((Date.parse(`${endDay}T00:00:00Z`) - Date.parse(`${startDay}T00:00:00Z`)) / DAY) + 1;
    if (spanDays > MAX_WINDOW_DAYS) throw new Error(`A window may cover at most ${MAX_WINDOW_DAYS} days.`);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid window." };
  }

  const label = (input.label ?? "").trim();
  if (label.length > MAX_LABEL_CHARS) return { ok: false, error: `Label must be ${MAX_LABEL_CHARS} characters or fewer.` };
  const notes = (input.notes ?? "").trim();

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.lifeEvent.create({
        data: {
          userId: user.id,
          kind,
          startDay,
          endDay,
          label: label || null,
          notes: notes ? encryptField(notes) : null,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          entityType: "LifeEvent",
          entityId: row.id,
          field: "create",
          newValue: `${kind} ${startDay}..${endDay}`,
        },
      });
      return row;
    });
    revalidatePath("/body");
    return { ok: true, id: created.id };
  } catch (e) {
    console.error("createLifeEvent failed", e);
    return { ok: false, error: "Could not save the window. Please try again." };
  }
}

/** Delete a window. Owner-checked; audited. Missing rows are treated as already deleted. */
export async function deleteLifeEvent(id: string): Promise<LifeEventResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const row = await prisma.lifeEvent.findUnique({ where: { id } });
  if (!row) return { ok: true };
  if (row.userId !== user.id) return { ok: false, error: "Not your window." };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.lifeEvent.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          entityType: "LifeEvent",
          entityId: id,
          field: "delete",
          oldValue: `${row.kind} ${row.startDay}..${row.endDay}`,
        },
      });
    });
  } catch (e) {
    console.error("deleteLifeEvent failed", e);
    return { ok: false, error: "Could not delete the window." };
  }

  revalidatePath("/body");
  return { ok: true };
}
