import { describe, it, expect } from "vitest";
import { displayMgPerMlFromStoredMcg, storeMcgPerMlFromMgInput } from "./prescription-wizard-concentration";

// The wizard stores mcg/mL. Float maths stored 1.005 mg/mL
// as 1004.9999999999999; Decimal must store it exactly.
describe("prescription wizard concentration", () => {
  it("1.005 mg/mL stores 1005 mcg/mL", () => {
    expect(storeMcgPerMlFromMgInput("1.005")).toBe("1005");
  });
  it("2.5 mg/mL stores 2500", () => {
    expect(storeMcgPerMlFromMgInput("2.5")).toBe("2500");
  });
  it("round trip is loss-free", () => {
    for (const mg of ["1.005", "0.333", "2.5", "10", "0.001", "4.4"]) {
      expect(displayMgPerMlFromStoredMcg(storeMcgPerMlFromMgInput(mg))).toBe(mg);
    }
  });
  it("blank stays blank; unparseable text passes through for the server to reject", () => {
    expect(storeMcgPerMlFromMgInput("  ")).toBe("");
    expect(storeMcgPerMlFromMgInput("abc")).toBe("abc");
    expect(displayMgPerMlFromStoredMcg("abc")).toBe("");
    expect(displayMgPerMlFromStoredMcg("")).toBe("");
  });
});
