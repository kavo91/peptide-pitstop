import Decimal from "decimal.js";
import { computeConcentrationMcgPerMl } from "@/lib/dosing/engine";
import { dosesPerWeek } from "@/lib/schedule/frequency";

export interface PreparationPreviewInput {
  enabled: boolean;
  prepType: "reconstituted" | "premixed";
  totalMg?: string;
  bacWaterMl?: string;
  concentrationMcgPerMl?: string;
  vialVolumeMl?: string;
}

export interface PreparationPreview {
  concentrationMcgPerMl: string | null;
  totalMg: string | null;
  remainingMl: string | null;
}

export interface StackWizardComponentDraft {
  peptideName?: string;
  concentrationMcgPerMl?: string;
  vialSizeMl?: string;
  qty?: string;
  doseMl?: string;
  scheduleRule?: string;
  startDate?: string;
  endDate?: string;
}

export function createNeutralStackWizardComponent(): Required<StackWizardComponentDraft> {
  return {
    peptideName: "",
    concentrationMcgPerMl: "",
    vialSizeMl: "",
    qty: "",
    doseMl: "",
    scheduleRule: "",
    startDate: "",
    endDate: "",
  };
}

export function createNeutralPreparationDraft() {
  return {
    enabled: false,
    prepType: "reconstituted" as "reconstituted" | "premixed",
    totalMg: "",
    bacWaterMl: "",
    concentrationMcgPerMl: "",
    vialVolumeMl: "",
    beyondUseDateISO: "",
  };
}

export function createNeutralProtocolDraft() {
  return {
    enabled: false,
    name: "",
    scheduleType: "fixed_times",
    scheduleRule: "",
    rebaseMode: "fixed_anchor",
    adherenceWindowMin: "120",
    defaultSyringeId: "",
    targetDose: "",
    doseInputUnit: "",
    doseBasis: "",
    startDate: "",
    endDate: "",
    status: "active",
  };
}

export function validateDirectionsConfirmation(input: {
  target: "peptide" | "stack";
  protocolEnabled?: boolean;
  confirmed?: boolean;
}): string | null {
  const createsProtocol = input.target === "stack" || input.protocolEnabled === true;
  return createsProtocol && input.confirmed !== true
    ? "Confirm that the dose and schedule were copied from the prescription or label."
    : null;
}

export function validateProtocolTranscriptionFields(input: {
  scheduleRule?: string | null;
  startDate?: string | null;
  targetDose?: string | null;
  doseInputUnit?: string | null;
  doseBasis?: string | null;
}): string | null {
  if (!(input.scheduleRule ?? "").trim()) return "Schedule is required.";
  if (!(input.startDate ?? "").trim()) return "Protocol start date is required.";
  if ((input.targetDose ?? "").trim()) {
    const unit = input.doseInputUnit;
    const basis = input.doseBasis;
    if (!["mcg", "mg", "ml", "units"].includes(unit ?? "")) {
      return "Choose the dose unit and basis exactly as written.";
    }
    if (basis !== "per_injection" && basis !== "per_week") {
      return "Choose the dose unit and basis exactly as written.";
    }
  }
  return null;
}

function positiveDecimal(v?: string | null): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  try {
    const d = new Decimal(s);
    return d.isFinite() && d.gt(0) ? d.toString() : null;
  } catch {
    return null;
  }
}

export function buildPreparationPreview(input: PreparationPreviewInput): PreparationPreview {
  if (!input.enabled) {
    return { concentrationMcgPerMl: null, totalMg: null, remainingMl: null };
  }

  if (input.prepType === "reconstituted") {
    const totalMg = positiveDecimal(input.totalMg);
    const bacWaterMl = positiveDecimal(input.bacWaterMl);
    if (!totalMg || !bacWaterMl) {
      return {
        concentrationMcgPerMl: null,
        totalMg: totalMg ?? null,
        remainingMl: bacWaterMl ?? null,
      };
    }
    return {
      concentrationMcgPerMl: computeConcentrationMcgPerMl({
        totalMassMg: totalMg,
        bacWaterMl,
      }).toString(),
      totalMg,
      remainingMl: bacWaterMl,
    };
  }

  const concentrationMcgPerMl = positiveDecimal(input.concentrationMcgPerMl);
  const remainingMl = positiveDecimal(input.vialVolumeMl);
  if (!concentrationMcgPerMl || !remainingMl) {
    return {
      concentrationMcgPerMl: concentrationMcgPerMl ?? null,
      totalMg: null,
      remainingMl: remainingMl ?? null,
    };
  }
  return {
    concentrationMcgPerMl,
    totalMg: new Decimal(concentrationMcgPerMl).times(remainingMl).div(1000).toString(),
    remainingMl,
  };
}

export function normaliseStackWizardComponent(input: StackWizardComponentDraft) {
  return {
    peptideName: (input.peptideName ?? "").trim(),
    concentrationMcgPerMl: (input.concentrationMcgPerMl ?? "").trim(),
    vialSizeMl: (input.vialSizeMl ?? "").trim(),
    qty: (input.qty ?? "").trim(),
    doseMl: (input.doseMl ?? "").trim(),
    scheduleRule: (input.scheduleRule ?? "").trim(),
    startDate: (input.startDate ?? "").trim(),
    endDate: (input.endDate ?? "").trim(),
  };
}

export function findDuplicateResolvedPeptideIds(resolvedPeptideIds: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of resolvedPeptideIds) {
    if (seen.has(id)) duplicates.add(id);
    else seen.add(id);
  }
  return [...duplicates];
}

export function isPerWeekScheduleBlocked(
  doseBasis?: string | null,
  scheduleRule?: string | null,
): boolean {
  if (doseBasis !== "per_week") return false;
  const injectionsPerWeek = dosesPerWeek(scheduleRule);
  return injectionsPerWeek == null || injectionsPerWeek <= 0;
}
