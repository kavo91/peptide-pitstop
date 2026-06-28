/**
 * The ONE shared seam for "what is this protocol's CURRENT per-injection dose?".
 *
 * Extracted verbatim from getTodayDoses' resolution block (today.ts §132-214) so
 * the Today card and the log-screen Protocol picker resolve doses through the
 * SAME safe path. SAFETY (spec §6): the per-injection value comes ONLY from the
 * resolver (`ResolvedSlot.perInjectionValue`, which itself runs `perInjectionDose`)
 * or the identical `perInjectionDose` fallback divide for a no-slot day. A raw
 * `Protocol.targetDose` / `step.dose` for a per_week protocol must NEVER reach a
 * dose field — for an UNRESOLVED injection frequency this returns doseValue "" so
 * callers leave the dose BLANK (and disable submit) rather than dial a full week's
 * dose into one injection.
 *
 * Pure: no I/O. Caller supplies the already-loaded delivered logs.
 */
import { resolveTitration } from "./resolve";
import { buildResolveInput, type ProtocolForResolve, type DeliveredLogInput } from "./from-protocol";
import { perInjectionDose } from "./dose-basis";
import { dosesPerWeek } from "../schedule/frequency";
import type { DoseUnit } from "../dosing/types";

export interface CurrentDose {
  doseValue: string;
  doseUnit: DoseUnit;
}

/**
 * Resolve a protocol's current per-injection dose as of `now` (default today).
 * Mirrors today.ts exactly: resolve over a single-day range at `now`, read the
 * first resolved slot's per-injection value; if no slot resolves (e.g. not due
 * today / no grid), fall back to the SAME perInjectionDose divide on targetDose.
 */
export function resolveCurrentDose(
  protocol: ProtocolForResolve,
  deliveredLogs: DeliveredLogInput[],
  now: Date = new Date(),
): CurrentDose {
  const resolved = resolveTitration(
    buildResolveInput({ protocol, deliveredLogs, range: { start: now, end: now }, now }),
  );
  const dayResolved = resolved.slots[0] ?? null;

  // Default unit identical to today.ts: resolved unit → protocol.doseInputUnit → "mcg".
  let doseValue = dayResolved?.perInjectionValue ?? "";
  let doseUnit = (dayResolved?.perInjectionUnit ?? (protocol.doseInputUnit as DoseUnit) ?? "mcg") as DoseUnit;

  // No-slot fallback (protocol not due on `now`): divide targetDose via the SAME
  // perInjectionDose path. Unresolved per_week frequency → per is null → stays "".
  if (!dayResolved && protocol.targetDose != null) {
    const per = perInjectionDose({
      doseBasis: protocol.doseBasis === "per_week" ? "per_week" : "per_injection",
      value: protocol.targetDose.toString(),
      unit: doseUnit,
      injectionsPerWeek: dosesPerWeek(protocol.scheduleRule),
    });
    if (per) {
      doseValue = per.value;
      doseUnit = per.unit;
    }
  }

  return { doseValue, doseUnit };
}
