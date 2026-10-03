import { describe, it, expect } from "vitest";
import { buildOralLogOptions, type OralPeptideForOptions } from "./oral-options";
import type { ProtocolForOptions } from "./protocol-options";

// The oral card on /log must pre-fill the SAME per-dose value
// /today shows — resolved through resolveCurrentDose — never the raw target.
const DAILY = "FREQ=DAILY";
const NOW = new Date(2026, 0, 7);

function proto(over: Partial<ProtocolForOptions>): ProtocolForOptions {
  return {
    id: "oral-proto",
    peptideId: "oral-pep",
    peptideName: "Oral Test",
    doseBasis: "per_injection",
    targetDose: "250",
    doseInputUnit: "mcg",
    scheduleRule: DAILY,
    rebaseMode: "fixed_anchor",
    startDate: null,
    endDate: null,
    adherenceWindowMin: 120,
    steps: [],
    deliveredLogs: [],
    ...over,
  };
}

function oralPeptide(p: ProtocolForOptions): OralPeptideForOptions {
  return {
    id: p.peptideId,
    name: p.peptideName,
    protocols: [{ id: p.id, doseInputUnit: p.doseInputUnit ?? null, targetDose: p.targetDose }],
  };
}

describe("buildOralLogOptions", () => {
  it("per_week 700 on a daily rule pre-fills 100, not 700", () => {
    const p = proto({ doseBasis: "per_week", targetDose: "700", scheduleRule: DAILY });
    const [o] = buildOralLogOptions([oralPeptide(p)], [p], NOW);
    expect(o.initialDoseValue).toBe("100");
    expect(o.initialDoseUnit).toBe("mcg");
    expect(o.protocolId).toBe("oral-proto");
  });

  it("a titrating oral protocol pre-fills the active step, not the flat target", () => {
    const p = proto({
      targetDose: "999",
      startDate: NOW,
      steps: [
        { stepIndex: 0, dose: "200", doseInputUnit: "mcg", durationDays: 14 },
        { stepIndex: 1, dose: "400", doseInputUnit: "mcg", durationDays: null },
      ],
    });
    const [o] = buildOralLogOptions([oralPeptide(p)], [p], NOW);
    expect(o.initialDoseValue).toBe("200");
  });

  it("per_week with an unresolvable frequency pre-fills blank", () => {
    const p = proto({ doseBasis: "per_week", targetDose: "700", scheduleRule: null });
    const [o] = buildOralLogOptions([oralPeptide(p)], [p], NOW);
    expect(o.initialDoseValue).toBe("");
  });

  it("per_injection mg passes through in mg", () => {
    const p = proto({ targetDose: "5", doseInputUnit: "mg" });
    const [o] = buildOralLogOptions([oralPeptide(p)], [p], NOW);
    expect(o.initialDoseValue).toBe("5");
    expect(o.initialDoseUnit).toBe("mg");
  });

  it("no single active protocol → blank, unlinked", () => {
    const [o] = buildOralLogOptions([{ id: "x", name: "X", protocols: [] }], [], NOW);
    expect(o.initialDoseValue).toBe("");
    expect(o.protocolId).toBeUndefined();
  });
});
