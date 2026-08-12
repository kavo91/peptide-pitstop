import { describe, expect, it } from "vitest";
import {
  createNeutralPreparationDraft,
  createNeutralProtocolDraft,
  createNeutralStackWizardComponent,
  validateDirectionsConfirmation,
  validateProtocolTranscriptionFields,
} from "./prescription-wizard";

describe("prescription wizard compliance defaults", () => {
  it("does not seed clinical values into a stack component", () => {
    expect(createNeutralStackWizardComponent()).toEqual({
      peptideName: "",
      concentrationMcgPerMl: "",
      vialSizeMl: "",
      qty: "",
      doseMl: "",
      scheduleRule: "",
      startDate: "",
      endDate: "",
    });
  });

  it("does not enable or prefill preparation and protocol creation", () => {
    expect(createNeutralPreparationDraft()).toMatchObject({
      enabled: false,
      totalMg: "",
      bacWaterMl: "",
      concentrationMcgPerMl: "",
      vialVolumeMl: "",
      beyondUseDateISO: "",
    });
    expect(createNeutralProtocolDraft()).toMatchObject({
      enabled: false,
      name: "",
      scheduleRule: "",
      defaultSyringeId: "",
      targetDose: "",
      doseInputUnit: "",
      doseBasis: "",
      startDate: "",
    });
  });

  it("requires explicit transcription confirmation before creating protocols", () => {
    expect(validateDirectionsConfirmation({ target: "peptide", protocolEnabled: false }))
      .toBeNull();
    expect(validateDirectionsConfirmation({ target: "peptide", protocolEnabled: true }))
      .toMatch(/copied from the prescription or label/i);
    expect(validateDirectionsConfirmation({ target: "stack", confirmed: false }))
      .toMatch(/copied from the prescription or label/i);
    expect(validateDirectionsConfirmation({ target: "stack", confirmed: true }))
      .toBeNull();
  });

  it("requires an explicit schedule, start date, and target-dose units", () => {
    expect(validateProtocolTranscriptionFields({})).toBe("Schedule is required.");
    expect(validateProtocolTranscriptionFields({ scheduleRule: "[]" }))
      .toBe("Protocol start date is required.");
    expect(validateProtocolTranscriptionFields({
      scheduleRule: "[]",
      startDate: "2026-07-11",
      targetDose: "1",
    })).toMatch(/dose unit and basis/i);
    expect(validateProtocolTranscriptionFields({
      scheduleRule: "[]",
      startDate: "2026-07-11",
      targetDose: "1",
      doseInputUnit: "mg",
      doseBasis: "per_injection",
    })).toBeNull();
  });
});
