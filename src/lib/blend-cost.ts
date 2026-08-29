/**
 * Per-component cost attribution for vendor blends.
 *
 * A blend is bought as ONE vial at ONE price. This splits that price across the
 * components by label mass fraction so a component's cost can be compared with
 * the same compound bought standalone. It creates no new spend: the split always
 * sums back to the vial's landed cost.
 *
 * Every figure is `derived` — the ratio is a vendor-label claim, not an assay.
 */
import { componentFractions, type BlendComponent, type BlendSource } from "./blends-core";

export interface ComponentCost {
  componentPeptideId: string;
  componentName: string;
  /** Share of the vial's landed cost attributable to this component. */
  cost: number;
  fraction: number;
  source: BlendSource;
  derived: true;
}

/**
 * Split a vial's landed cost across its components.
 * Returns [] for a non-blend, or when the vial has no resolvable cost.
 */
export function splitCostByComponent(
  landedUnitCost: string | number | null,
  components: BlendComponent[],
): ComponentCost[] {
  if (landedUnitCost === null || landedUnitCost === undefined) return [];
  const total = typeof landedUnitCost === "number" ? landedUnitCost : Number(landedUnitCost);
  if (!Number.isFinite(total)) return [];

  const fractions = componentFractions(components);
  if (fractions.size === 0) return [];

  return [...components]
    .sort((a, b) => a.sortIndex - b.sortIndex)
    .map((c) => {
      const fraction = fractions.get(c.componentPeptideId) ?? 0;
      return {
        componentPeptideId: c.componentPeptideId,
        componentName: c.componentName,
        cost: total * fraction,
        fraction,
        source: c.source,
        derived: true as const,
      };
    });
}
