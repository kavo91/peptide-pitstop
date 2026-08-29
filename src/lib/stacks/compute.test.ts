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

import { describe as d2, expect as e2, it as i2 } from "vitest";
import { stackComponentResolution } from "./compute";

const NOW = new Date("2026-08-28T09:00:00+10:00");
const base = {
  doseBasis: "per_injection",
  targetDose: "0.2",
  doseInputUnit: "ml",
  scheduleRule: DAILY_SCHEDULE_RULE,
  rebaseMode: "fixed_anchor",
  startDate: new Date("2026-08-24T00:00:00Z"),
  endDate: null,
  adherenceWindowMin: 120,
};

d2("stackComponentResolution", () => {
  i2("returns null for a no-steps component (byte-identical legacy rendering)", () => {
    e2(stackComponentResolution({ ...base, steps: [] }, [], "5000", NOW)).toBeNull();
  });

  i2("returns null when steps exist but startDate is unset (resolver-inert ladder)", () => {
    e2(
      stackComponentResolution(
        { ...base, startDate: null, steps: [{ stepIndex: 0, dose: "200", doseInputUnit: "mcg", durationDays: null }] },
        [],
        "5000",
        NOW,
      ),
    ).toBeNull();
  });

  i2("resolves phase-0 step dose with mcg→ml alt display via the prep concentration", () => {
    const r = stackComponentResolution(
      {
        ...base,
        steps: [
          { stepIndex: 0, dose: "200", doseInputUnit: "mcg", durationDays: 14 },
          { stepIndex: 1, dose: "300", doseInputUnit: "mcg", durationDays: null },
        ],
      },
      [],
      "5000",
      NOW,
    );
    e2(r).not.toBeNull();
    e2(r!.doseValue).toBe("200");
    e2(r!.doseUnit).toBe("mcg");
    e2(r!.altDisplay).toBe("≈ 0.04 ml");
    e2(r!.phaseIndex).toBe(0);
    e2(r!.phaseCount).toBe(2);
    e2(r!.targetInPhase).toBe(14); // daily schedule: 14 days → 14 doses
  });

  i2("advances to the next step by delivered-dose count, addressing steps by stepIndex not array order", () => {
    // steps supplied REVERSED — resolution must still pick stepIndex 1 after 14 delivered
    const logs = Array.from({ length: 14 }, (_, i) => ({
      id: `l${i}`,
      takenAt: new Date(Date.UTC(2026, 7, 10 + i, 22, 0, 0)),
      localDay: `2026-08-${String(11 + i).padStart(2, "0")}`,
    }));
    const r = stackComponentResolution(
      {
        ...base,
        startDate: new Date("2026-08-10T00:00:00Z"),
        steps: [
          { stepIndex: 1, dose: "300", doseInputUnit: "mcg", durationDays: null },
          { stepIndex: 0, dose: "200", doseInputUnit: "mcg", durationDays: 14 },
        ],
      },
      logs,
      "5000",
      NOW,
    );
    e2(r!.phaseIndex).toBe(1);
    e2(r!.doseValue).toBe("300");
    e2(r!.altDisplay).toBe("≈ 0.06 ml");
  });

  i2("preserves the '' fail-safe for an unresolvable per_week frequency", () => {
    const r = stackComponentResolution(
      {
        ...base,
        doseBasis: "per_week",
        scheduleRule: null, // dosesPerWeek unresolvable
        steps: [{ stepIndex: 0, dose: "1400", doseInputUnit: "mcg", durationDays: null }],
      },
      [],
      "5000",
      NOW,
    );
    // titrating but the weekly value can't be divided — dose must stay blank
    e2(r === null || r.doseValue === "").toBe(true);
    if (r) e2(r.altDisplay).toBeNull();
  });
});

d2("stackComponentResolution — no-slot days show the active step, never targetDose", () => {
  i2("pre-start window resolves step 0's dose, not the flat maintenance volume", () => {
    const r = stackComponentResolution(
      {
        doseBasis: "per_injection",
        targetDose: "0.08", // the FINAL (400 mcg) maintenance volume
        doseInputUnit: "ml",
        scheduleRule: JSON.stringify([{ dayPattern: { kind: "daily" }, times: [] }]),
        rebaseMode: "fixed_anchor",
        startDate: new Date("2026-09-07T00:00:00Z"), // starts NEXT week
        endDate: null,
        adherenceWindowMin: 120,
        steps: [
          { stepIndex: 0, dose: "200", doseInputUnit: "mcg", durationDays: 14 },
          { stepIndex: 1, dose: "400", doseInputUnit: "mcg", durationDays: null },
        ],
      },
      [],
      "5000",
      new Date("2026-08-28T09:00:00+10:00"),
    );
    e2(r).not.toBeNull();
    e2(r!.doseValue).toBe("200");
    e2(r!.doseUnit).toBe("mcg");
    e2(r!.phaseIndex).toBe(0);
  });
});
