import { describe, it, expect } from "vitest";
import { protocolTemplateToInput, templateToRampSteps, frequencyToDayPattern } from "./protocol-template";
import type { EnrichmentTemplate } from "./peptide-enrichment";
import { dosesPerWeek } from "./schedule/frequency";
import { generateRamp } from "./titration/generate-ramp";

const PEP = "pep-123";

describe("frequencyToDayPattern", () => {
  it("daily → daily", () => {
    expect(frequencyToDayPattern("Once daily (subcutaneous)")).toEqual({ kind: "daily" });
  });
  it("once weekly → weekly on a single resolvable day", () => {
    const p = frequencyToDayPattern("Once weekly (subcutaneous)");
    expect(p?.kind).toBe("weekly");
    if (p?.kind === "weekly") expect(p.byDays.length).toBe(1);
  });
  it("twice weekly → weekly two evenly-spaced days", () => {
    const p = frequencyToDayPattern("Twice weekly");
    expect(p?.kind).toBe("weekly");
    if (p?.kind === "weekly") expect(p.byDays.length).toBe(2);
  });
  it("N× per week → weekly N evenly-spaced days", () => {
    const p = frequencyToDayPattern("3x per week subcutaneous");
    expect(p?.kind).toBe("weekly");
    if (p?.kind === "weekly") expect(p.byDays.length).toBe(3);
  });
  it("N days/week → weekly N evenly-spaced days", () => {
    const p = frequencyToDayPattern("5 days/week");
    expect(p?.kind).toBe("weekly");
    if (p?.kind === "weekly") expect(p.byDays.length).toBe(5);
  });
  it("N days per week → weekly N evenly-spaced days", () => {
    const p = frequencyToDayPattern("2 days per week");
    expect(p?.kind).toBe("weekly");
    if (p?.kind === "weekly") expect(p.byDays.length).toBe(2);
  });
  it("every N days → interval", () => {
    expect(frequencyToDayPattern("Every 3 days")).toEqual({ kind: "interval", everyDays: 3 });
  });
  it("null / unresolvable → null (caller decides default)", () => {
    expect(frequencyToDayPattern(null)).toBeNull();
    expect(frequencyToDayPattern("as directed")).toBeNull();
  });
});

describe("protocolTemplateToInput — per_week GLP-1 with ramp", () => {
  const t: EnrichmentTemplate = {
    name: "Standard / Gradual Approach",
    doseBasis: "per_week",
    targetDose: 10,
    unit: "mg",
    frequency: "Once weekly (subcutaneous)",
    ramp: [
      { phase: "Weeks 1–4", dose: 2.5, unit: "mg", doseLabel: "2.5 mg" },
      { phase: "Weeks 5–8", dose: 5, unit: "mg", doseLabel: "5 mg" },
      { phase: "Weeks 9–12", dose: 7.5, unit: "mg", doseLabel: "7.5 mg" },
      { phase: "Weeks 13–16", dose: 10, unit: "mg", doseLabel: "10 mg" },
    ],
  };

  it("maps name, peptideId, dose, unit, basis", () => {
    const input = protocolTemplateToInput(t, PEP);
    expect(input.peptideId).toBe(PEP);
    expect(input.name).toBe("Standard / Gradual Approach");
    expect(input.targetDose).toBe("10");
    expect(input.doseInputUnit).toBe("mg");
    expect(input.doseBasis).toBe("per_week");
  });

  it("builds a frequency-resolvable schedule so perWeekBlocked won't block", () => {
    const input = protocolTemplateToInput(t, PEP);
    expect(input.scheduleRule).toBeTruthy();
    // dosesPerWeek must resolve to a positive number (mirrors ProtocolForm's guard).
    const dpw = dosesPerWeek(input.scheduleRule!);
    expect(dpw).not.toBeNull();
    expect(dpw!).toBeGreaterThan(0);
  });

  it("has a ramp → scheduleType titration", () => {
    expect(protocolTemplateToInput(t, PEP).scheduleType).toBe("titration");
  });
});

describe("protocolTemplateToInput — per_injection mcg/day, no ramp", () => {
  const t: EnrichmentTemplate = {
    name: "Daily Support",
    doseBasis: "per_injection",
    targetDose: 300,
    unit: "mcg",
    frequency: "Once daily (subcutaneous)",
  };

  it("maps to per_injection daily fixed_times", () => {
    const input = protocolTemplateToInput(t, PEP);
    expect(input.doseBasis).toBe("per_injection");
    expect(input.targetDose).toBe("300");
    expect(input.doseInputUnit).toBe("mcg");
    expect(input.scheduleType).toBe("fixed_times");
    expect(input.scheduleRule).toContain("daily");
  });
});

describe("protocolTemplateToInput — iu unit maps to units", () => {
  const t: EnrichmentTemplate = {
    name: "IU template",
    doseBasis: "per_injection",
    targetDose: 100,
    unit: "iu",
    frequency: "Once daily",
  };
  it("maps iu → units", () => {
    expect(protocolTemplateToInput(t, PEP).doseInputUnit).toBe("units");
  });
});

describe("protocolTemplateToInput — null targetDose is safe", () => {
  const t: EnrichmentTemplate = {
    name: "Unknown dose",
    doseBasis: "per_injection",
    targetDose: null,
    unit: "mcg",
    frequency: "Once daily",
  };
  it("leaves targetDose blank (undefined), never NaN", () => {
    const input = protocolTemplateToInput(t, PEP);
    expect(input.targetDose).toBeUndefined();
  });
});

describe("protocolTemplateToInput — per_week with unresolvable frequency still resolves", () => {
  const t: EnrichmentTemplate = {
    name: "Vague per-week",
    doseBasis: "per_week",
    targetDose: 5,
    unit: "mg",
    frequency: "as directed",
  };
  it("falls back to a weekly schedule so per-week dosing isn't blocked", () => {
    const input = protocolTemplateToInput(t, PEP);
    const dpw = dosesPerWeek(input.scheduleRule!);
    expect(dpw).not.toBeNull();
    expect(dpw!).toBeGreaterThan(0);
  });
});

describe("templateToRampSteps", () => {
  it("ramp template → RampParams feeding generateRamp", () => {
    const t: EnrichmentTemplate = {
      name: "Ramp",
      doseBasis: "per_injection",
      targetDose: 600,
      unit: "mcg",
      frequency: "Once daily",
      ramp: [
        { phase: "Weeks 1–2", dose: 200, unit: "mcg", doseLabel: "200 mcg" },
        { phase: "Weeks 3–4", dose: 400, unit: "mcg", doseLabel: "400 mcg" },
        { phase: "Weeks 5–8+", dose: 600, unit: "mcg", doseLabel: "600 mcg" },
      ],
    };
    const params = templateToRampSteps(t);
    expect(params).not.toBeNull();
    expect(params!.startDose).toBe("200");
    expect(params!.targetDose).toBe("600");
    expect(params!.increment).toBe("200");
    expect(params!.doseInputUnit).toBe("mcg");
    expect(params!.weeksPerStep).toBeGreaterThan(0);
    // The params must drive generateRamp without throwing and land on target.
    const steps = generateRamp(params!);
    expect(steps[steps.length - 1].dose).toBe("600");
  });

  it("no ramp → null", () => {
    const t: EnrichmentTemplate = {
      name: "No ramp",
      doseBasis: "per_injection",
      targetDose: 300,
      unit: "mcg",
      frequency: "Once daily",
    };
    expect(templateToRampSteps(t)).toBeNull();
  });

  it("single-phase ramp → null (no titration to generate)", () => {
    const t: EnrichmentTemplate = {
      name: "Single",
      doseBasis: "per_injection",
      targetDose: 300,
      unit: "mcg",
      frequency: "Once daily",
      ramp: [{ phase: "Weeks 1–8", dose: 300, unit: "mcg", doseLabel: "300 mcg" }],
    };
    expect(templateToRampSteps(t)).toBeNull();
  });

  it("ramp with null start/target doses → null (can't ramp safely)", () => {
    const t: EnrichmentTemplate = {
      name: "Null doses",
      doseBasis: "per_injection",
      targetDose: null,
      unit: "mcg",
      frequency: "Once daily",
      ramp: [
        { phase: "Weeks 1–2", dose: null, unit: "mcg", doseLabel: "?" },
        { phase: "Weeks 3–4", dose: null, unit: "mcg", doseLabel: "?" },
      ],
    };
    expect(templateToRampSteps(t)).toBeNull();
  });
});
