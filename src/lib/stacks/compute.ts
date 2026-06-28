import Decimal from "decimal.js";

/** Daily fixed_times schedule rule (no specific time) — matches ProtocolForm's default entry. */
export const DAILY_SCHEDULE_RULE = JSON.stringify([{ dayPattern: { kind: "daily" }, times: [] }]);

function pos(v: string): Decimal | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  try {
    const d = new Decimal(s);
    return d.isFinite() && d.gt(0) ? d : null;
  } catch {
    return null;
  }
}

/** Total peptide mass in a premixed vial, in mg. concentration(mcg/ml) * volume(ml) / 1000. */
export function vialLabelStrengthMg(concentrationMcgPerMl: string, vialSizeMl: string): string | null {
  const c = pos(concentrationMcgPerMl);
  const v = pos(vialSizeMl);
  if (!c || !v) return null;
  return c.times(v).div(1000).toString();
}

/** Mass delivered per injection, in mcg. doseMl * concentration(mcg/ml). dose may be 0. */
export function perInjectionMcg(doseMl: string, concentrationMcgPerMl: string): string | null {
  const c = pos(concentrationMcgPerMl);
  if (!c) return null;
  const s = (doseMl ?? "").trim();
  if (!s) return null;
  let d: Decimal;
  try {
    d = new Decimal(s);
  } catch {
    return null;
  }
  if (!d.isFinite() || d.lt(0)) return null;
  return d.times(c).toString();
}
