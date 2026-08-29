/**
 * Pure blend arithmetic — no DB, no Prisma, no I/O.
 *
 * A vendor blend is ONE vial of blended dry powder (e.g. KLOW = 50 mg GHK-Cu +
 * 10 mg each of BPC-157 / TB-500 / KPV in an 80 mg vial). It is modelled as a
 * single Peptide with a single Protocol dosing the BLEND in mcg. Per-component
 * masses are DERIVED here at read time and are never written to a DoseLog.
 *
 * Every value produced carries `derived: true` plus the `source` of the ratio,
 * so a derived mass can never be presented as a measured one.
 */

export type BlendSource = "label" | "coa" | "assumed";

export interface BlendComponent {
  componentPeptideId: string;
  componentName: string;
  /** Mass of this component in one labelled vial of the blend, in mg. */
  massMg: number;
  source: BlendSource;
  sortIndex: number;
}

export interface DerivedComponentDose {
  componentPeptideId: string;
  componentName: string;
  /** Component mass delivered by this dose, in mcg. */
  doseMcg: number;
  fraction: number;
  source: BlendSource;
  derived: true;
}

const bySortIndex = (a: BlendComponent, b: BlendComponent) => a.sortIndex - b.sortIndex;

const totalMassMg = (components: BlendComponent[]): number =>
  components.reduce((sum, c) => sum + (Number.isFinite(c.massMg) ? c.massMg : 0), 0);

/** Fraction of the blend each component represents, keyed by componentPeptideId. */
export function componentFractions(components: BlendComponent[]): Map<string, number> {
  const total = totalMassMg(components);
  const out = new Map<string, number>();
  if (total <= 0) return out;
  for (const c of components) out.set(c.componentPeptideId, c.massMg / total);
  return out;
}

/**
 * Split one blend dose (mcg) into its component masses (mcg).
 * Returns [] when there are no components — a non-blend peptide is untouched.
 */
export function expandBlendDose(
  blendDoseMcg: number,
  components: BlendComponent[],
): DerivedComponentDose[] {
  const fractions = componentFractions(components);
  if (fractions.size === 0) return [];
  return [...components].sort(bySortIndex).map((c) => {
    const fraction = fractions.get(c.componentPeptideId) ?? 0;
    return {
      componentPeptideId: c.componentPeptideId,
      componentName: c.componentName,
      doseMcg: blendDoseMcg * fraction,
      fraction,
      source: c.source,
      derived: true as const,
    };
  });
}

/**
 * Does the component mass sum match the vial's declared strength?
 * Advisory only — callers WARN, they must not hard-fail, so a mis-set
 * defaultStrengthMg can never lock a user out of editing their own blend.
 */
export function blendMassCheck(
  components: BlendComponent[],
  expectedMg: number | null,
): { ok: boolean; sumMg: number; expectedMg: number | null } {
  const sumMg = totalMassMg(components);
  if (expectedMg === null) return { ok: true, sumMg, expectedMg: null };
  return { ok: Math.abs(sumMg - expectedMg) < 1e-9, sumMg, expectedMg };
}

// ── Exposure roll-up ───────────────────────────────────────────────────────
// Pure, so it lives here rather than in the server-only module: a blend's
// derived component mass must be aggregated with the SAME compound's
// standalone protocol history, otherwise cumulative exposure understates it.

export interface StandaloneExposure {
  peptideId: string;
  peptideName: string;
  totalMcg: number;
}

export interface ExposureRow {
  peptideId: string;
  peptideName: string;
  standaloneMcg: number;
  blendMcg: number;
  totalMcg: number;
  /** True when any part of totalMcg came from a blend ratio rather than a logged dose. */
  hasDerived: boolean;
}

/** Merge standalone logged exposure with blend-delivered derived exposure. */
export function rollUpExposure(input: {
  standalone: StandaloneExposure[];
  derived: DerivedComponentDose[];
}): ExposureRow[] {
  const rows = new Map<string, ExposureRow>();

  for (const s of input.standalone) {
    // ACCUMULATE, never overwrite. Two entries can legitimately share a key:
    // the analytics roll-up keys this by peptide NAME so derived component rows
    // merge with standalone history, and Peptide has no unique-name constraint.
    // A plain set() silently dropped one course's entire delivered mass from a
    // table headed "all time" — invisible, because the row still looked right.
    const existing = rows.get(s.peptideId);
    if (existing) {
      existing.standaloneMcg += s.totalMcg;
      existing.totalMcg += s.totalMcg;
      continue;
    }
    rows.set(s.peptideId, {
      peptideId: s.peptideId,
      peptideName: s.peptideName,
      standaloneMcg: s.totalMcg,
      blendMcg: 0,
      totalMcg: s.totalMcg,
      hasDerived: false,
    });
  }

  for (const d of input.derived) {
    const existing = rows.get(d.componentPeptideId);
    if (existing) {
      existing.blendMcg += d.doseMcg;
      existing.totalMcg += d.doseMcg;
      existing.hasDerived = true;
    } else {
      rows.set(d.componentPeptideId, {
        peptideId: d.componentPeptideId,
        peptideName: d.componentName,
        standaloneMcg: 0,
        blendMcg: d.doseMcg,
        totalMcg: d.doseMcg,
        hasDerived: true,
      });
    }
  }

  return [...rows.values()].sort((a, b) => b.totalMcg - a.totalMcg);
}

/**
 * Prospective split of a NOT-YET-LOGGED dose (a titration step, a form value,
 * a today-card dose) into component masses. Unit-honest:
 *   mcg → direct; mg → ×1000; ml → × prep concentration (null without it);
 *   units → ALWAYS null (syringe-relative — the meaning depends on a syringe
 *   this surface hasn't chosen; the logged path records the true mass instead).
 * Returns null rather than a wrong or guessed number, per spec §6 discipline.
 */
export function splitProspectiveDose(
  doseValue: string,
  doseUnit: string,
  components: BlendComponent[],
  concentrationMcgPerMl?: string | null,
): DerivedComponentDose[] | null {
  if (components.length === 0) return null;
  const v = Number(doseValue);
  if (!Number.isFinite(v) || v <= 0) return null;
  let mcg: number;
  if (doseUnit === "mcg") mcg = v;
  else if (doseUnit === "mg") mcg = v * 1000;
  else if (doseUnit === "ml") {
    const conc = Number(concentrationMcgPerMl);
    if (!Number.isFinite(conc) || conc <= 0) return null;
    mcg = v * conc;
  } else return null; // "units" and anything unknown: fail-safe
  const split = expandBlendDose(mcg, components);
  return split.length > 0 ? split : null;
}

/**
 * The provenance a DISPLAYED split may claim: the weakest source among the
 * components. One assumed ratio taints every derived mass (fractions share the
 * total-mass denominator), so a mixed label+assumed blend must present as
 * "assumed" — never borrow the first row's stronger provenance.
 */
export function weakestBlendSource(components: { source: BlendSource }[]): BlendSource {
  const rank: Record<BlendSource, number> = { assumed: 0, coa: 1, label: 2 };
  let weakest: BlendSource = "label";
  for (const c of components) if (rank[c.source] < rank[weakest]) weakest = c.source;
  return weakest;
}

/**
 * Round split masses for display so the components SUM to the rounded parent
 * (largest-remainder at `dp` decimals). Independent half-up rounding printed
 * "156.3 · 31.3 · 31.3 · 31.3" beside "Delivers 250.0" — 0.2 over the parent
 * on the same screen.
 */
export function roundSplitForDisplay(values: number[], dp = 1): number[] {
  const f = 10 ** dp;
  const total = Math.round(values.reduce((s, v) => s + v, 0) * f);
  const floors = values.map((v) => Math.floor(v * f + 1e-9));
  let remainder = total - floors.reduce((s, v) => s + v, 0);
  const order = values
    .map((v, i) => ({ i, frac: v * f - Math.floor(v * f + 1e-9) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) out[order[k].i] += 1;
  return out.map((v) => v / f);
}
