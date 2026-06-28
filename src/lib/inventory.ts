/**
 * Inventory view model: every vial a user holds, with its active preparation,
 * depletion forecast (remaining doses / days left), and the data the recon
 * wizard needs to prepare an unopened vial. Server-side (reads DB).
 *
 * Depletion is derived, never stored: remainingDoses = floor(remainingMl /
 * per-dose volume), where per-dose volume comes from the peptide's active
 * protocol (titration-aware). All maths is decimal via the dosing engine.
 */
import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { canonicaliseDose, dosesPerVial } from "@/lib/dosing/engine";
import { dosesPerWeek } from "@/lib/schedule/frequency";
import { resolveTitration } from "@/lib/titration/resolve";
import { buildResolveInput } from "@/lib/titration/from-protocol";
import { perInjectionDose } from "@/lib/titration/dose-basis";
import type { DoseUnit } from "@/lib/dosing/types";

// Re-export so existing importers (`@/lib/inventory`) keep working after the
// move to the pure schedule/frequency module.
export { dosesPerWeek } from "@/lib/schedule/frequency";

export interface SyringeDTO {
  id: string;
  name: string;
  graduationType: "units" | "ml";
  unitsPerMl: number;
  capacityMl: string;
  capacityUnits: number;
  increment: string;
}

export interface VialView {
  id: string;
  peptideId: string;
  peptideName: string;
  labelStrengthMg: string;
  status: string; // sealed | in_use | finished | discarded
  lot: string | null;
  expiry: string | null; // ISO yyyy-mm-dd
  expired: boolean;
  prescriptionId: string | null;
  prescriptionLabel: string | null; // prescription.source (plaintext) for inline display
  prepared: boolean;
  prepType: "reconstituted" | "premixed" | null;
  concentrationMcgPerMl: string | null;
  remainingMl: string | null;
  beyondUseDate: string | null;
  beyondUsePassed: boolean;
  remainingDoses: number | null;
  daysLeft: number | null;
  /** For unprepared vials: target dose + syringe to drive the recon wizard preview. */
  recon: { targetDose?: string; targetUnit?: DoseUnit; syringe: SyringeDTO | null } | null;
}

function toDateInput(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString().slice(0, 10) : null;
}

/**
 * Projected dose yield for an UNPREPARED vial, derived purely from data already
 * in scope (label strength + the protocol's per-injection target). It is the
 * same dose count the ReconWizard previews — and, crucially, it does NOT depend
 * on the (not-yet-chosen) BAC water volume:
 *
 *   conc       = totalMcg / bacWater
 *   doseVolume = doseMcg / conc            = doseMcg × bacWater / totalMcg
 *   yield      = bacWater / doseVolume     = totalMcg / doseMcg
 *
 * So the BAC water cancels out and the dose count is honestly derivable for
 * mass-unit targets (mcg/mg). For `ml`/`units` targets the count depends on the
 * concentration (and so on the BAC water we don't have), so we return null and
 * the caller SKIPS the line rather than invent a number.
 *
 * Pure: no I/O. Returns the projected dose count, or null if not cleanly
 * derivable (non-mass unit, missing/invalid inputs, non-positive dose).
 */
export function projectedSealedDoses(args: {
  labelStrengthMg: string | null | undefined;
  targetDose: string | null | undefined;
  targetUnit: DoseUnit | null | undefined;
}): number | null {
  const { labelStrengthMg, targetDose, targetUnit } = args;
  if (labelStrengthMg == null || targetDose == null || targetUnit == null) return null;
  // Only mass-unit targets cancel the BAC water out; ml/units need concentration.
  if (targetUnit !== "mcg" && targetUnit !== "mg") return null;
  try {
    const totalMcg = new Decimal(labelStrengthMg).times(1000);
    const doseMcg = targetUnit === "mg" ? new Decimal(targetDose).times(1000) : new Decimal(targetDose);
    if (!totalMcg.isFinite() || !doseMcg.isFinite() || doseMcg.lte(0) || totalMcg.lte(0)) return null;
    return totalMcg.div(doseMcg).floor().toNumber();
  } catch {
    return null;
  }
}

export async function getInventory(userId: string, now = new Date()): Promise<VialView[]> {
  const vials = await prisma.vial.findMany({
    where: { userId },
    include: {
      peptide: true,
      prescription: { select: { id: true, source: true } },
      preparations: { where: { active: true }, orderBy: { reconstitutedAt: "desc" }, take: 1 },
    },
    orderBy: [{ status: "asc" }, { peptide: { name: "asc" } }],
  });

  // One active protocol per peptide drives per-dose volume + frequency.
  const protocols = await prisma.protocol.findMany({
    where: { userId, status: "active" },
    include: { steps: true },
  });
  const protoByPeptide = new Map<string, (typeof protocols)[number]>();
  for (const p of protocols) if (!protoByPeptide.has(p.peptideId)) protoByPeptide.set(p.peptideId, p);

  // The resolver's phase cursor counts delivered doses, so each protocol needs
  // its full DoseLog history. Loaded once, grouped by protocolId.
  const protocolIds = [...protoByPeptide.values()].map((p) => p.id);
  const logsByProtocol = new Map<string, { id: string; takenAt: Date }[]>();
  if (protocolIds.length > 0) {
    const logs = await prisma.doseLog.findMany({
      where: { userId, protocolId: { in: protocolIds } },
      select: { id: true, takenAt: true, protocolId: true },
    });
    for (const l of logs) {
      if (!l.protocolId) continue;
      const arr = logsByProtocol.get(l.protocolId) ?? [];
      arr.push({ id: l.id, takenAt: l.takenAt });
      logsByProtocol.set(l.protocolId, arr);
    }
  }

  const syringes = await prisma.syringe.findMany({ where: { OR: [{ userId }, { userId: null }] } });
  const syringeById = new Map(syringes.map((s) => [s.id, s]));
  const toSyringeDTO = (id: string | null | undefined): SyringeDTO | null => {
    const s = id ? syringeById.get(id) : null;
    if (!s) return null;
    return {
      id: s.id,
      name: s.name,
      graduationType: s.graduationType as "units" | "ml",
      unitsPerMl: s.unitsPerMl,
      capacityMl: s.capacityMl.toString(),
      capacityUnits: s.capacityUnits,
      increment: s.increment.toString(),
    };
  };

  // Resolve a protocol's current per-injection dose via the single source of
  // truth. The resolver divides a per_week dose by injections/week and applies
  // the active titration phase — a raw step.dose/targetDose must NEVER reach the
  // volume math (spec §6). Falls back to proto.targetDose only when the resolver
  // yields no slot for `now`.
  function currentDose(proto: (typeof protocols)[number]): { value: string; unit: DoseUnit } | null {
    const resolved = resolveTitration(
      buildResolveInput({
        protocol: proto,
        deliveredLogs: logsByProtocol.get(proto.id) ?? [],
        range: { start: now, end: now },
        now,
      }),
    );
    const slot = resolved.slots[0] ?? null;
    if (slot) return { value: slot.perInjectionValue, unit: slot.perInjectionUnit };

    // No slot for `now` (e.g. an off-schedule day). Fall back to the protocol
    // target — but a per_week target MUST still be divided to per-injection so
    // the volume math never sees a raw weekly value (spec §6).
    if (proto.targetDose == null) return null;
    const fbUnit = (proto.doseInputUnit as DoseUnit) ?? "mcg";
    const per = perInjectionDose({
      doseBasis: proto.doseBasis === "per_week" ? "per_week" : "per_injection",
      value: proto.targetDose.toString(),
      unit: fbUnit,
      injectionsPerWeek: dosesPerWeek(proto.scheduleRule),
    });
    return per ?? { value: proto.targetDose.toString(), unit: fbUnit };
  }

  return vials.map((v) => {
    const prep = v.preparations[0] ?? null;
    const proto = protoByPeptide.get(v.peptideId) ?? null;
    const dose = proto ? currentDose(proto) : null;

    let remainingDoses: number | null = null;
    let daysLeft: number | null = null;

    if (prep && dose) {
      const syr = toSyringeDTO(proto?.defaultSyringeId);
      try {
        const { volumeMl } = canonicaliseDose({
          dose: { value: dose.value, unit: dose.unit },
          preparation: {
            prepType: prep.prepType as "reconstituted" | "premixed",
            concentrationMcgPerMl: new Decimal(prep.concentrationMcgPerMl.toString()),
          },
          // Only matters for unit-input doses; default U-100 otherwise.
          syringe: {
            name: "",
            graduationType: "units",
            unitsPerMl: syr?.unitsPerMl ?? 100,
            capacityMl: 1,
            capacityUnits: 100,
            increment: 1,
          },
        });
        if (volumeMl.gt(0)) {
          remainingDoses = dosesPerVial({
            totalVolumeMl: prep.remainingMl.toString(),
            doseVolumeMl: volumeMl.toString(),
          }).toNumber();
          const perWeek = dosesPerWeek(proto?.scheduleRule);
          if (perWeek && perWeek > 0) daysLeft = Math.round((remainingDoses / perWeek) * 7);
        }
      } catch {
        /* leave nulls on any math edge */
      }
    }

    const expiry = v.expiry ? new Date(v.expiry) : null;
    const bud = prep?.beyondUseDate ? new Date(prep.beyondUseDate) : null;

    return {
      id: v.id,
      peptideId: v.peptideId,
      peptideName: v.peptide.name,
      labelStrengthMg: v.labelStrengthMg.toString(),
      status: v.status,
      lot: v.lot,
      expiry: toDateInput(expiry),
      expired: expiry ? expiry < now : false,
      prescriptionId: v.prescriptionId,
      prescriptionLabel: v.prescription?.source ?? (v.prescriptionId ? "Linked" : null),
      prepared: Boolean(prep),
      prepType: prep ? (prep.prepType as "reconstituted" | "premixed") : null,
      concentrationMcgPerMl: prep ? prep.concentrationMcgPerMl.toString() : null,
      remainingMl: prep ? prep.remainingMl.toString() : null,
      beyondUseDate: toDateInput(bud),
      beyondUsePassed: bud ? bud < now : false,
      remainingDoses,
      daysLeft,
      recon: prep
        ? null
        : { targetDose: dose?.value, targetUnit: dose?.unit, syringe: toSyringeDTO(proto?.defaultSyringeId) },
    };
  });
}
