import Decimal from "decimal.js";

export interface ReconEditArgs {
  /** New concentration (mcg/mL) — computed from corrected bacWater/strength, or entered for premixed. */
  newConcentrationMcgPerMl: Decimal.Value;
  /** Corrected fill volume (mL): bacWaterMl (reconstituted) or vial volume (premixed). */
  newTotalMl: Decimal.Value;
  /** All logged doses on this prep; volume is the immovable physical draw. */
  doses: { id: string; volumeMl: Decimal.Value }[];
}
export interface ReconEditResult {
  remainingMl: string;
  remainingClamped: boolean;
  doses: { id: string; doseMcg: string }[];
}

/** Editing a recon: mass = volumeMl × newConcentration (volume fixed); remaining = newTotal − Σdrawn (clamp ≥0). */
export function recomputeReconEdit(args: ReconEditArgs): ReconEditResult {
  const conc = new Decimal(args.newConcentrationMcgPerMl);
  const total = new Decimal(args.newTotalMl);
  let drawn = new Decimal(0);
  const doses = args.doses.map((d) => {
    const vol = new Decimal(d.volumeMl);
    drawn = drawn.plus(vol);
    return { id: d.id, doseMcg: vol.times(conc).toString() };
  });
  const raw = total.minus(drawn);
  const clamped = raw.lt(0);
  return { remainingMl: Decimal.max(raw, 0).toString(), remainingClamped: clamped, doses };
}

/** Editing a dose's drawn volume: remaining ← remaining + oldVol − newVol, clamped to [0, fillCap]. */
export function reconcileDoseEditRemaining(args: {
  remainingMl: Decimal.Value; oldVolumeMl: Decimal.Value; newVolumeMl: Decimal.Value; fillCapMl: Decimal.Value;
}): { remainingMl: string; clamped: boolean } {
  const r = new Decimal(args.remainingMl).plus(args.oldVolumeMl).minus(args.newVolumeMl);
  const cap = new Decimal(args.fillCapMl);
  const clamped = r.lt(0) || r.gt(cap);
  return { remainingMl: Decimal.min(Decimal.max(r, 0), cap).toString(), clamped };
}
