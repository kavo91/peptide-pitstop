import { describe, it, expect } from "vitest";
import { vialLabelStrengthMg, perInjectionMcg, DAILY_SCHEDULE_RULE } from "./compute";

describe("stack compute", () => {
  it("vialLabelStrengthMg = mcgPerMl * ml / 1000", () => {
    expect(vialLabelStrengthMg("2000", "5")).toBe("10");
    expect(vialLabelStrengthMg("3000", "5")).toBe("15");
    expect(vialLabelStrengthMg("2500", "3")).toBe("7.5");
  });

  it("perInjectionMcg = doseMl * mcgPerMl", () => {
    expect(perInjectionMcg("0.2", "2000")).toBe("400");
    expect(perInjectionMcg("0.2", "3000")).toBe("600");
    expect(perInjectionMcg("0", "3000")).toBe("0");
  });

  it("returns null for non-positive / invalid concentration or volume", () => {
    expect(vialLabelStrengthMg("0", "5")).toBeNull();
    expect(vialLabelStrengthMg("2000", "")).toBeNull();
    expect(perInjectionMcg("abc", "2000")).toBeNull();
  });

  it("DAILY_SCHEDULE_RULE is the daily fixed_times JSON", () => {
    expect(JSON.parse(DAILY_SCHEDULE_RULE)).toEqual([{ dayPattern: { kind: "daily" }, times: [] }]);
  });
});
