import "server-only";
import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { canonicaliseDose, dosesPerVial } from "@/lib/dosing/engine";
import { dosesPerWeek } from "@/lib/schedule/frequency";
import { resolveTitration } from "@/lib/titration/resolve";
import { buildResolveInput } from "@/lib/titration/from-protocol";
import { perInjectionDose } from "@/lib/titration/dose-basis";
import { assessReorder, type ReorderStatus } from "@/lib/reorder-core";
import type { DoseUnit } from "@/lib/dosing/types";

const DEFAULT_LEAD_DAYS = 14;
const DEFAULT_BUFFER_DAYS = 3;

export interface PeptideReorder {
  peptideId: string;
  peptideName: string;
  status: ReorderStatus;
  coverageDays: number | null;
  depletionDate: string | null;
  reorderByDate: string | null;
  leadTimeDays: number;
}

/** Convert a dose to mcg, or null if its unit can't be mass-resolved (ml/units). */
function doseToMcg(value: string, unit: DoseUnit): Decimal | null {
  const v = new Decimal(value);
  if (unit === "mcg") return v;
  if (unit === "mg") return v.times(1000);
  return null; // ml / units → needs concentration; can't size a sealed vial
}

export async function getReorderStatus(userId: string, now = new Date()): Promise<PeptideReorder[]> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const userLead = user?.reorderLeadTimeDays ?? DEFAULT_LEAD_DAYS;
  const bufferDays = user?.reorderBufferDays ?? DEFAULT_BUFFER_DAYS;

  // Peptides with an active protocol (no protocol ⇒ no consumption rate ⇒ skip).
  const protocols = await prisma.protocol.findMany({
    where: { userId, status: "active" },
    include: { peptide: true, steps: true, prescription: true },
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

  // Most-recent active prescription (with a lead time) per peptide — fallback
  // when a protocol has no linked prescription.
  const standingRx = await prisma.prescription.findMany({
    where: { userId, status: "active", leadTimeDays: { not: null } },
    orderBy: { dateWritten: "desc" },
    select: { peptideId: true, leadTimeDays: true },
  });
  const leadByPeptide = new Map<string, number>();
  // Skip stack (grouped) prescriptions — they have no single peptide.
  for (const rx of standingRx) if (rx.peptideId && !leadByPeptide.has(rx.peptideId)) leadByPeptide.set(rx.peptideId, rx.leadTimeDays!);

  const results: PeptideReorder[] = [];

  for (const proto of protoByPeptide.values()) {
    // Current per-injection dose via the single source of truth (same as
    // inventory.ts). This {value,unit} feeds BOTH the in-use prep volume path
    // (canonicaliseDose) and the sealed-vial mass path (doseToMcg) — neither
    // may read a raw step.dose/targetDose, or a per_week weekly value would
    // size the vial estimate 7×–365× too low (spec §6).
    const resolved = resolveTitration(
      buildResolveInput({
        protocol: proto,
        deliveredLogs: logsByProtocol.get(proto.id) ?? [],
        range: { start: now, end: now },
        now,
      }),
    );
    const slot = resolved.slots[0] ?? null;
    let doseValue: string | null;
    let doseUnit: DoseUnit;
    if (slot) {
      doseValue = slot.perInjectionValue;
      doseUnit = slot.perInjectionUnit;
    } else {
      // No slot for `now`: fall back to the protocol target, but still divide a
      // per_week target to per-injection so neither vial path sees a raw weekly.
      doseUnit = (proto.doseInputUnit as DoseUnit) ?? "mcg";
      if (proto.targetDose == null) {
        doseValue = null;
      } else {
        const per = perInjectionDose({
          doseBasis: proto.doseBasis === "per_week" ? "per_week" : "per_injection",
          value: proto.targetDose.toString(),
          unit: doseUnit,
          injectionsPerWeek: dosesPerWeek(proto.scheduleRule),
        });
        doseValue = per ? per.value : proto.targetDose.toString();
        if (per) doseUnit = per.unit;
      }
    }

    // Lead time: linked prescription → standing prescription → user default.
    const leadTimeDays = proto.prescriptionId
      ? (proto.prescription?.leadTimeDays ?? userLead)
      : (leadByPeptide.get(proto.peptideId) ?? userLead);

    // Aggregate doses across this peptide's non-finished vials.
    const vials = await prisma.vial.findMany({
      where: { userId, peptideId: proto.peptideId, status: { in: ["sealed", "in_use"] } },
      include: { preparations: { where: { active: true }, orderBy: { reconstitutedAt: "desc" }, take: 1 } },
    });

    let totalDoses: number | null = null;
    if (doseValue) {
      let sum = 0;
      let computable = true;
      for (const v of vials) {
        const prep = v.preparations[0] ?? null;
        if (prep) {
          // In-use prep: volume-based, works for any dose unit.
          try {
            const { volumeMl } = canonicaliseDose({
              dose: { value: doseValue, unit: doseUnit },
              preparation: { prepType: prep.prepType as "reconstituted" | "premixed", concentrationMcgPerMl: new Decimal(prep.concentrationMcgPerMl.toString()) },
              syringe: { name: "", graduationType: "units", unitsPerMl: 100, capacityMl: 1, capacityUnits: 100, increment: 1 },
            });
            if (volumeMl.gt(0)) {
              sum += dosesPerVial({ totalVolumeMl: prep.remainingMl.toString(), doseVolumeMl: volumeMl.toString() }).toNumber();
            } else { computable = false; }
          } catch { computable = false; }
        } else {
          // Sealed vial: mass-based estimate (independent of dilution).
          const doseMcg = doseToMcg(doseValue, doseUnit);
          if (!doseMcg || doseMcg.lte(0)) { computable = false; }
          else {
            const vialMcg = new Decimal(v.labelStrengthMg.toString()).times(1000);
            sum += vialMcg.div(doseMcg).floor().toNumber();
          }
        }
      }
      totalDoses = computable ? sum : null;
    }

    const perWeek = dosesPerWeek(proto.scheduleRule);
    const r = assessReorder({ totalDoses, dosesPerWeek: perWeek, leadTimeDays, bufferDays, today: now });
    results.push({
      peptideId: proto.peptideId,
      peptideName: proto.peptide.name,
      status: r.status,
      coverageDays: r.coverageDays,
      depletionDate: r.depletionDate,
      reorderByDate: r.reorderByDate,
      leadTimeDays: r.leadTimeDays,
    });
  }

  // reorder_now first, then soonest reorderByDate, then name.
  const rank: Record<ReorderStatus, number> = { reorder_now: 0, ok: 1, unknown: 2 };
  return results.sort((a, b) =>
    rank[a.status] - rank[b.status] ||
    (a.reorderByDate ?? "9999").localeCompare(b.reorderByDate ?? "9999") ||
    a.peptideName.localeCompare(b.peptideName),
  );
}
