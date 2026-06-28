"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { encryptField } from "@/lib/crypto/fieldEncryption";
import { serializeSideEffects, type SideEffectEntry } from "@/lib/side-effects";

export interface JournalInput {
  /** "yyyy-MM-dd" or full ISO; defaults to now. */
  dateISO?: string;
  weight?: string;
  /** "kg" | "lb" */
  weightUnit?: string;
  /** "1".."5" */
  mood?: string;
  /** "1".."5" */
  energy?: string;
  /** hours, decimal */
  sleep?: string;
  /** energy intake, kcal (integer) */
  calories?: string;
  /** protein, grams (decimal) */
  proteinG?: string;
  /** water intake, mL (integer) */
  waterMl?: string;
  /** structured side effects — serialized to JSON and stored encrypted */
  sideEffects?: SideEffectEntry[];
  /** plaintext — stored encrypted */
  notes?: string;
  /** optional link to a logged dose (ownership-checked) */
  doseLogId?: string;
}

export type UpdateJournalInput = JournalInput & { id: string };

export interface JournalResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/** Strictly-positive finite decimal, or null. */
function posDecimal(v: string | undefined | null): Decimal | null {
  const s = (v ?? "").toString().trim();
  if (!s) return null;
  try {
    const d = new Decimal(s);
    return d.isFinite() && d.gt(0) ? d : null;
  } catch {
    return null;
  }
}

/** Non-negative finite decimal, or null. */
function nonNegDecimal(v: string | undefined | null): Decimal | null {
  const s = (v ?? "").toString().trim();
  if (!s) return null;
  try {
    const d = new Decimal(s);
    return d.isFinite() && d.gte(0) ? d : null;
  } catch {
    return null;
  }
}

/** Non-negative finite integer, or null. */
function nonNegInt(v: string | undefined | null): number | null {
  const s = (v ?? "").toString().trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Parse a 1–5 rating: null when blank, "invalid" when out of range. */
function parseRating(v: string | undefined): number | null | "invalid" {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) return "invalid";
  return n;
}

interface ParsedJournal {
  date: Date;
  weight: string | null;
  weightUnit: string | null;
  mood: number | null;
  energy: number | null;
  sleep: string | null;
  calories: number | null;
  proteinG: string | null;
  waterMl: number | null;
  sideEffects: string | null; // serialized JSON (NOT yet encrypted)
  notes: string | null; // plaintext (NOT yet encrypted)
  doseLogId: string | null;
}

/** Validate + normalise the plain-JSON input. Pure (no DB). */
function parseJournalInput(input: JournalInput): ParsedJournal | { error: string } {
  let date = new Date();
  if (input.dateISO && input.dateISO.trim()) {
    const d = new Date(input.dateISO.trim());
    if (Number.isNaN(d.getTime())) return { error: "Enter a valid date." };
    date = d;
  }

  let weight: string | null = null;
  let weightUnit: string | null = null;
  if (input.weight && input.weight.trim()) {
    const w = posDecimal(input.weight);
    if (!w) return { error: "Enter a valid weight." };
    weight = w.toString();
    const u = (input.weightUnit ?? "kg").toLowerCase();
    if (u !== "kg" && u !== "lb") return { error: "Weight unit must be kg or lb." };
    weightUnit = u;
  }

  const mood = parseRating(input.mood);
  if (mood === "invalid") return { error: "Mood must be between 1 and 5." };
  const energy = parseRating(input.energy);
  if (energy === "invalid") return { error: "Energy must be between 1 and 5." };

  let sleep: string | null = null;
  if (input.sleep && input.sleep.trim()) {
    const s = nonNegDecimal(input.sleep);
    if (!s || s.gt(24)) return { error: "Enter sleep hours between 0 and 24." };
    sleep = s.toString();
  }

  let calories: number | null = null;
  if (input.calories && input.calories.trim()) {
    calories = nonNegInt(input.calories);
    if (calories == null) return { error: "Enter calories as a whole number." };
  }

  let proteinG: string | null = null;
  if (input.proteinG && input.proteinG.trim()) {
    const p = nonNegDecimal(input.proteinG);
    if (!p) return { error: "Enter protein as a non-negative number." };
    proteinG = p.toString();
  }

  let waterMl: number | null = null;
  if (input.waterMl && input.waterMl.trim()) {
    waterMl = nonNegInt(input.waterMl);
    if (waterMl == null) return { error: "Enter water as a whole number of mL." };
  }

  const sideEffects = serializeSideEffects(input.sideEffects);
  const notes = input.notes && input.notes.trim() ? input.notes.trim() : null;
  const doseLogId = input.doseLogId && input.doseLogId.trim() ? input.doseLogId.trim() : null;

  return { date, weight, weightUnit, mood, energy, sleep, calories, proteinG, waterMl, sideEffects, notes, doseLogId };
}

/** Reject a doseLogId that isn't the caller's. Returns an error string or null. */
async function assertDoseLogOwned(userId: string, doseLogId: string | null): Promise<string | null> {
  if (!doseLogId) return null;
  const owns = await prisma.doseLog.count({ where: { id: doseLogId, userId } });
  return owns ? null : "Linked dose log not found.";
}

export async function createJournalEntry(input: JournalInput): Promise<JournalResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const parsed = parseJournalInput(input);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const ownErr = await assertDoseLogOwned(user.id, parsed.doseLogId);
  if (ownErr) return { ok: false, error: ownErr };

  try {
    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.journalEntry.create({
        data: {
          userId: user.id,
          date: parsed.date,
          weight: parsed.weight,
          weightUnit: parsed.weightUnit,
          mood: parsed.mood,
          energy: parsed.energy,
          sleep: parsed.sleep,
          calories: parsed.calories,
          proteinG: parsed.proteinG,
          waterMl: parsed.waterMl,
          sideEffects: parsed.sideEffects ? encryptField(parsed.sideEffects) : null,
          notes: parsed.notes ? encryptField(parsed.notes) : null,
          doseLogId: parsed.doseLogId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          entityType: "JournalEntry",
          entityId: created.id,
          field: "create",
          newValue: `wellness entry @ ${parsed.date.toISOString()}`,
        },
      });
      return created;
    });

    revalidatePath("/journal");
    revalidatePath("/");
    return { ok: true, id: entry.id };
  } catch (e) {
    console.error("createJournalEntry failed", e);
    return { ok: false, error: "Could not save the entry. Please try again." };
  }
}

export async function updateJournalEntry(input: UpdateJournalInput): Promise<JournalResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Ownership-scoped lookup — rejects ids that aren't the caller's.
  const existing = await prisma.journalEntry.findFirst({ where: { id: input.id, userId: user.id } });
  if (!existing) return { ok: false, error: "Entry not found." };

  const parsed = parseJournalInput(input);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const ownErr = await assertDoseLogOwned(user.id, parsed.doseLogId);
  if (ownErr) return { ok: false, error: ownErr };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.journalEntry.update({
        where: { id: existing.id },
        data: {
          date: parsed.date,
          weight: parsed.weight,
          weightUnit: parsed.weightUnit,
          mood: parsed.mood,
          energy: parsed.energy,
          sleep: parsed.sleep,
          calories: parsed.calories,
          proteinG: parsed.proteinG,
          waterMl: parsed.waterMl,
          sideEffects: parsed.sideEffects ? encryptField(parsed.sideEffects) : null,
          notes: parsed.notes ? encryptField(parsed.notes) : null,
          doseLogId: parsed.doseLogId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          entityType: "JournalEntry",
          entityId: existing.id,
          field: "edit",
          oldValue: `wellness entry @ ${existing.date.toISOString()}`,
          newValue: `wellness entry @ ${parsed.date.toISOString()}`,
        },
      });
    });

    revalidatePath("/journal");
    revalidatePath("/");
    return { ok: true, id: existing.id };
  } catch (e) {
    console.error("updateJournalEntry failed", e);
    return { ok: false, error: "Could not save the edit." };
  }
}

export async function deleteJournalEntry(input: { id: string }): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const entry = await prisma.journalEntry.findUnique({ where: { id: input.id } });
  if (!entry) return { ok: true };
  if (entry.userId !== user.id) return { ok: false, error: "Not your entry." };

  try {
    await prisma.$transaction(async (tx) => {
      const removed = await tx.journalEntry.deleteMany({ where: { id: entry.id } });
      if (removed.count === 1) {
        await tx.auditLog.create({
          data: {
            userId: user.id,
            entityType: "JournalEntry",
            entityId: entry.id,
            field: "delete",
            oldValue: `wellness entry @ ${entry.date.toISOString()}`,
          },
        });
      }
    });
  } catch (e) {
    console.error("deleteJournalEntry failed", e);
    return { ok: false, error: "Could not delete the entry." };
  }

  revalidatePath("/journal");
  revalidatePath("/");
  return { ok: true };
}
