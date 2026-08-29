import "server-only";

import { prisma } from "@/lib/db";
import { PEPTIDE_LIBRARY } from "@/lib/peptide-library";
import { perInjectionMcg, stackComponentResolution, type StackComponentResolution } from "@/lib/stacks/compute";
import { courseTips } from "@/lib/stacks/lineage";

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
  /** The protocol's dose unit — "ml" for stack-created rows; a revised successor may differ. */
  doseInputUnit: string;
  perInjectionMcg: string | null;
  /**
   * Resolver-sourced current dose + phase for a TITRATING component (steps +
   * startDate); null otherwise so no-steps stacks render exactly as before.
   * doseValue "" = unresolvable — render a hint, never a number (spec §6).
   */
  resolved: StackComponentResolution | null;
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
    include: {
      protocols: {
        include: {
          peptide: true,
          steps: true,
          // FULL history — the resolver's phase cursor is dose-count based and
          // range-independent; a horizon slice would misplace the phase.
          doseLogs: { select: { id: true, takenAt: true, localDay: true } },
        },
        orderBy: { id: "asc" },
      },
      prescriptions: true,
    },
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
    // Course TIPS only: after a revision the completed predecessor stays in the
    // stack as frozen history — listing it would duplicate the peptide, leak a
    // zombie resolved dose, and (worse) seed the schedule editor from the OLD
    // rule. Never-revised stacks (incl. fully completed legacy ones) pass through.
    const tips = courseTips(s.protocols);
    for (const p of tips) {
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
        doseInputUnit: p.doseInputUnit ?? "ml",
        // ml × conc only makes sense for an ml dose — a revised successor may
        // hold mcg/mg, where this product would be a fabricated number.
        perInjectionMcg: prep && (p.doseInputUnit ?? "ml") === "ml" ? perInjectionMcg(dose, prep.concentrationMcgPerMl.toString()) : null,
        resolved: stackComponentResolution(p, p.doseLogs, prep ? prep.concentrationMcgPerMl.toString() : null),
        remainingMl: prep?.remainingMl?.toString() ?? null,
        expiry: prep?.vial?.expiry ? prep.vial.expiry.toISOString().slice(0, 10) : null,
        halfLifeHours,
      });
    }
    // Components share one schedule (createStack seeds them identically and
    // updateStackSchedule writes all of them together) — read it off the first
    // TIP, never a revised-out predecessor (whose frozen rule would re-seed the
    // editor with the pre-revision schedule).
    const first = tips[0] ?? null;
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
