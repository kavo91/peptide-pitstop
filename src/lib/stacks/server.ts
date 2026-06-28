import "server-only";

import { prisma } from "@/lib/db";
import { PEPTIDE_LIBRARY } from "@/lib/peptide-library";
import { perInjectionMcg } from "@/lib/stacks/compute";

/** Name + aliases (lower-cased) for a peptide. Tolerates both JSON-array and
 *  comma-separated alias storage (the codebase has both). */
export function peptideTokens(p: { name: string; aliases: string | null }): string[] {
  const raw = (p.aliases ?? "").trim();
  let aliases: string[] = [];
  if (raw.startsWith("[")) {
    try {
      const arr: unknown = JSON.parse(raw);
      if (Array.isArray(arr)) aliases = arr.filter((x): x is string => typeof x === "string");
    } catch {
      /* fall through to comma split */
    }
  }
  if (aliases.length === 0 && raw) aliases = raw.split(",");
  return [p.name, ...aliases].map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Library half-life fallback for an owned peptide whose stored halfLifeHours is
 * empty — mirrors the settings page's libHalfLife() so stacks display parity with
 * the peptide list. Matches the library by name OR alias (case-insensitive).
 * Returns null when nothing matches (keeps the row clean).
 */
function libHalfLifeHours(name: string, aliases: string | null): string | null {
  const ts = peptideTokens({ name, aliases });
  const hit = PEPTIDE_LIBRARY.find((e) => peptideTokens({ name: e.name, aliases: e.aliases ?? null }).some((t) => ts.includes(t)));
  return hit?.halfLifeHours ?? null;
}

export interface StackComponentView {
  protocolId: string;
  peptideName: string;
  doseMl: string;
  perInjectionMcg: string | null;
  remainingMl: string | null;
  expiry: string | null; // ISO date (yyyy-mm-dd) or null
  halfLifeHours: string | null; // stored value, else library fallback by name/alias
}
export interface StackPrescriptionView {
  id: string;
  source: string | null;
  refillsRemaining: number | null;
  nextRefill: string | null; // ISO yyyy-mm-dd
  expiry: string | null; // ISO yyyy-mm-dd
}
export interface StackView {
  id: string;
  name: string;
  components: StackComponentView[];
  /** The single grouped prescription covering this stack, if recorded. */
  prescription: StackPrescriptionView | null;
  /**
   * Stack-level schedule, read from the component protocols (they share one
   * schedule — createStack seeds them all with DAILY_SCHEDULE_RULE and
   * updateStackSchedule keeps them in sync). Taken from the first component;
   * null when the stack has no components. `scheduleRule` is the stored JSON
   * (or legacy RRULE) string; `startDate` is ISO yyyy-mm-dd or null.
   */
  scheduleRule: string | null;
  startDate: string | null;
}

/** Stacks for a user with each component's per-injection mcg and remaining ml/expiry. */
export async function getStacks(userId: string): Promise<StackView[]> {
  const stacks = await prisma.stack.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { protocols: { include: { peptide: true }, orderBy: { id: "asc" } }, prescriptions: true },
  });
  const out: StackView[] = [];
  for (const s of stacks) {
    const rx = s.prescriptions[0] ?? null;
    const prescription: StackPrescriptionView | null = rx
      ? {
          id: rx.id,
          source: rx.source,
          refillsRemaining: rx.refillsRemaining,
          nextRefill: rx.nextRefill ? rx.nextRefill.toISOString().slice(0, 10) : null,
          expiry: rx.expiration ? rx.expiration.toISOString().slice(0, 10) : null,
        }
      : null;
    const components: StackComponentView[] = [];
    for (const p of s.protocols) {
      const prep = await prisma.preparation.findFirst({
        // Prefer the pinned vial; legacy rows (null vialId) fall back to peptideId.
        where: p.vialId ? { active: true, vialId: p.vialId } : { active: true, vial: { peptideId: p.peptideId, userId } },
        orderBy: { reconstitutedAt: "desc" },
        include: { vial: true },
      });
      const dose = p.targetDose?.toString() ?? "";
      const halfLifeHours =
        p.peptide.halfLifeHours != null
          ? p.peptide.halfLifeHours.toString()
          : libHalfLifeHours(p.peptide.name, p.peptide.aliases);
      components.push({
        protocolId: p.id,
        peptideName: p.peptide.name,
        doseMl: dose,
        perInjectionMcg: prep ? perInjectionMcg(dose, prep.concentrationMcgPerMl.toString()) : null,
        remainingMl: prep?.remainingMl?.toString() ?? null,
        expiry: prep?.vial?.expiry ? prep.vial.expiry.toISOString().slice(0, 10) : null,
        halfLifeHours,
      });
    }
    // Components share one schedule (createStack seeds them identically and
    // updateStackSchedule writes all of them together) — read it off the first.
    const first = s.protocols[0] ?? null;
    out.push({
      id: s.id,
      name: s.name,
      components,
      prescription,
      scheduleRule: first?.scheduleRule ?? null,
      startDate: first?.startDate ? first.startDate.toISOString().slice(0, 10) : null,
    });
  }
  return out;
}
