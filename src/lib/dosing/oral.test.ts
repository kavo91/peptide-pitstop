import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { buildOralDoseRecord, oralDoseMcg, isOralDoseUnit, formatLoggedDoseDisplay } from "./oral";
import { computeDraw } from "./engine";

describe("oralDoseMcg", () => {
  it("passes mcg through unchanged", () => {
    expect(oralDoseMcg("500", "mcg").toString()).toBe("500");
  });

  it("converts mg → mcg (× 1000)", () => {
    expect(oralDoseMcg("2", "mg").toString()).toBe("2000");
    expect(oralDoseMcg("0.25", "mg").toString()).toBe("250");
  });

  it("rejects volume/needle units (no preparation for oral)", () => {
    expect(() => oralDoseMcg("1", "ml")).toThrow();
    expect(() => oralDoseMcg("10", "units")).toThrow();
  });

  it("rejects a negative value", () => {
    expect(() => oralDoseMcg("-1", "mg")).toThrow();
  });
});

describe("isOralDoseUnit", () => {
  it("accepts mass units only", () => {
    expect(isOralDoseUnit("mcg")).toBe(true);
    expect(isOralDoseUnit("mg")).toBe(true);
    expect(isOralDoseUnit("ml")).toBe(false);
    expect(isOralDoseUnit("units")).toBe(false);
  });
});

describe("buildOralDoseRecord", () => {
  it("assembles a prep-less, syringe-less, site-less record with the correct doseMcg", () => {
    const rec = buildOralDoseRecord({ doseValue: "2", doseUnit: "mg" });
    expect(rec).toEqual({
      preparationId: null,
      syringeId: null,
      syringeUnits: null,
      injectionSite: null,
      volumeMl: "0",
      route: "oral",
      doseMcg: "2000",
      doseInputUnit: "mg",
    });
  });

  it("keeps the entered unit for mcg input", () => {
    const rec = buildOralDoseRecord({ doseValue: "750", doseUnit: "mcg" });
    expect(rec.doseMcg).toBe("750");
    expect(rec.doseInputUnit).toBe("mcg");
    expect(rec.volumeMl).toBe("0");
    expect(rec.route).toBe("oral");
  });

  it("uses '0' (string) as the NOT-NULL volume sentinel", () => {
    const rec = buildOralDoseRecord({ doseValue: "1", doseUnit: "mg" });
    expect(rec.volumeMl).toBe("0");
    // It is a valid Decimal '0'.
    expect(new Decimal(rec.volumeMl).isZero()).toBe(true);
  });
});

describe("formatLoggedDoseDisplay (null-guarded display helper)", () => {
  it("shows mg for an oral mg dose (mcg → mg)", () => {
    expect(formatLoggedDoseDisplay({ doseMcg: "2000", doseInputUnit: "mg", route: "oral" })).toBe("2 mg");
  });

  it("shows mcg for an oral mcg dose", () => {
    expect(formatLoggedDoseDisplay({ doseMcg: "750", doseInputUnit: "mcg", route: "oral" })).toBe("750 mcg");
  });

  it("always shows mcg for an injection dose, regardless of input unit", () => {
    expect(formatLoggedDoseDisplay({ doseMcg: "1500", doseInputUnit: "units", route: "injection" })).toBe("1,500 mcg");
  });

  it("falls back to mcg on an empty/missing oral unit", () => {
    expect(formatLoggedDoseDisplay({ doseMcg: "500", doseInputUnit: "", route: "oral" })).toBe("500 mcg");
  });
});

describe("injection path is unaffected by the oral branch (regression)", () => {
  // The injection dose-build is computeDraw — entirely independent of oral.ts.
  // This pins that an injection draw still produces a full volume/marking/mass
  // result (preparation + syringe present), unchanged by the oral additions.
  it("computeDraw still delivers volume, marking and mass for an injection", () => {
    const r = computeDraw({
      dose: { value: "1500", unit: "mcg" },
      preparation: { prepType: "premixed", concentrationMcgPerMl: new Decimal("3000") },
      syringe: {
        name: "U-100 0.5 mL", graduationType: "units", unitsPerMl: 100,
        capacityMl: "0.5", capacityUnits: 50, increment: "1",
      },
      remainingMl: "1",
    });
    expect(r.markingScale).toBe("units");
    expect(r.markingValue.toNumber()).toBe(50);
    expect(r.deliveredVolumeMl.toNumber()).toBeCloseTo(0.5, 6);
    expect(r.deliveredMassMcg.toNumber()).toBe(1500);
  });
});
