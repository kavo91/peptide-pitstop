import type { DosePoint } from "./plasma";
import type { ResolvedSlot } from "./titration/types";

/** Slot date+time as a Date (local midnight if untimed). */
function slotAt(s: ResolvedSlot): Date {
  if (!s.time) return new Date(s.date);
  const [h, m] = s.time.split(":").map(Number);
  return new Date(new Date(s.date).getTime() + h * 3_600_000 + m * 60_000);
}

/**
 * Convert the resolver's PROJECTED future slots into plasma DosePoints.
 * Per-injection doses are already basis-divided + phase-resolved by the resolver;
 * we only convert to mcg mass. Unconvertible units (ml/units) and empty values
 * are skipped → that protocol's forward curve is decay-only, never fabricated.
 */
export function forwardDosePoints(
  slots: ResolvedSlot[],
  toMcg: (value: string, unit: string) => number | null,
): DosePoint[] {
  const out: DosePoint[] = [];
  for (const s of slots) {
    if (!s.isProjected) continue;
    if (s.perInjectionValue === "") continue;
    const mcg = toMcg(s.perInjectionValue, s.perInjectionUnit);
    if (mcg == null) continue;
    out.push({ at: slotAt(s), amountMcg: mcg });
  }
  return out;
}
