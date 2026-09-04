import { describe, it, expect } from "vitest";
import {
  courseKey,
  daysSpentInPhase,
  endDateOnClose,
  materialProtocolChange,
  assertNoScheduleRewrite,
  planCarryForward,
  type ProtocolSnapshot,
  type CarryStep,
} from "@/lib/protocol-revision";

const base: ProtocolSnapshot = {
  scheduleRule: JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "TH"] }, times: [] }]),
  doseBasis: "per_injection",
  startDate: "2026-06-01",
  steps: [
    { stepIndex: 0, durationDays: 14 },
    { stepIndex: 1, durationDays: 14 },
  ],
};

describe("materialProtocolChange", () => {
  it("is empty when nothing material changed", () => {
    expect(materialProtocolChange(base, { ...base })).toEqual([]);
  });

  it("flags a dosing-schedule change (4x weekly -> daily)", () => {
    const after = { ...base, scheduleRule: JSON.stringify([{ dayPattern: { kind: "daily" }, times: [] }]) };
    expect(materialProtocolChange(base, after)).toEqual(["dosing schedule"]);
  });

  it("flags a dose-basis change", () => {
    expect(materialProtocolChange(base, { ...base, doseBasis: "per_week" })).toEqual(["dose basis"]);
  });

  it("flags a start-date change", () => {
    expect(materialProtocolChange(base, { ...base, startDate: "2026-07-01" })).toEqual(["start date"]);
  });

  it("flags a change in the NUMBER of titration steps", () => {
    const after = { ...base, steps: [...base.steps, { stepIndex: 2, durationDays: 14 }] };
    expect(materialProtocolChange(base, after)).toEqual(["titration steps"]);
  });

  it("flags a change to a step's durationDays", () => {
    const after = { ...base, steps: [{ stepIndex: 0, durationDays: 21 }, { stepIndex: 1, durationDays: 14 }] };
    expect(materialProtocolChange(base, after)).toEqual(["titration steps"]);
  });

  it("compares steps by stepIndex, not array order", () => {
    const after = { ...base, steps: [base.steps[1], base.steps[0]] };
    expect(materialProtocolChange(base, after)).toEqual([]);
  });

  it("reports every changed field so the dialog can name them", () => {
    const after = { ...base, doseBasis: "per_week", startDate: "2026-07-01" };
    expect(materialProtocolChange(base, after)).toEqual(["dose basis", "start date"]);
  });
});

describe("assertNoScheduleRewrite", () => {
  const after = { ...base, doseBasis: "per_week" };

  it("throws when a material field changes on an active protocol with doses", () => {
    expect(() =>
      assertNoScheduleRewrite(base, after, { status: "active", hasDeliveredDoses: true }),
    ).toThrow(/dose basis/);
  });

  it("names every changed field in the message", () => {
    const both = { ...base, doseBasis: "per_week", startDate: "2026-07-01" };
    expect(() =>
      assertNoScheduleRewrite(base, both, { status: "active", hasDeliveredDoses: true }),
    ).toThrow(/dose basis.*start date/);
  });

  it("allows the change when no dose has been delivered yet", () => {
    expect(() =>
      assertNoScheduleRewrite(base, after, { status: "active", hasDeliveredDoses: false }),
    ).not.toThrow();
  });

  it("allows the change on a paused or completed protocol", () => {
    for (const status of ["paused", "completed"]) {
      expect(() =>
        assertNoScheduleRewrite(base, after, { status, hasDeliveredDoses: true }),
      ).not.toThrow();
    }
  });

  it("allows an immaterial change on a live dosed protocol", () => {
    expect(() =>
      assertNoScheduleRewrite(base, { ...base }, { status: "active", hasDeliveredDoses: true }),
    ).not.toThrow();
  });
});

describe("courseKey", () => {
  it("resolves a standalone protocol to its own id", () => {
    expect(courseKey({ id: "p1", courseId: null })).toBe("p1");
  });

  it("returns the shared course id for a revision", () => {
    expect(courseKey({ id: "p2", courseId: "p1" })).toBe("p1");
  });

  it("gives a chain of three revisions ONE key", () => {
    const chain = [
      { id: "p1", courseId: null },
      { id: "p2", courseId: "p1" },
      { id: "p3", courseId: "p1" },
    ];
    expect(new Set(chain.map(courseKey)).size).toBe(1);
  });
});

const ladder: CarryStep[] = [
  { stepIndex: 0, dose: "200", doseInputUnit: "mcg", durationDays: 14 },
  { stepIndex: 1, dose: "400", doseInputUnit: "mcg", durationDays: 14 },
  { stepIndex: 2, dose: "600", doseInputUnit: "mcg", durationDays: 14 },
  { stepIndex: 3, dose: "800", doseInputUnit: "mcg", durationDays: null },
];

describe("planCarryForward", () => {
  it("resumes at the step the OLD frequency says you are on", () => {
    // 4x/week -> targets [8,8,8,null]. 11 delivered = step 1.
    const out = planCarryForward({ steps: ladder, injectionsPerWeek: 4, deliveredCount: 11, daysSpentInCurrentPhase: 6 });
    expect(out[0].dose).toBe("400");
  });

  it("re-indexes the carried steps from zero", () => {
    const out = planCarryForward({ steps: ladder, injectionsPerWeek: 4, deliveredCount: 11, daysSpentInCurrentPhase: 6 });
    expect(out.map((s) => s.stepIndex)).toEqual([0, 1, 2]);
  });

  it("shortens ONLY the current step by the days already spent in it", () => {
    const out = planCarryForward({ steps: ladder, injectionsPerWeek: 4, deliveredCount: 11, daysSpentInCurrentPhase: 6 });
    expect(out[0].durationDays).toBe(8); // 14 - 6
  });

  it("copies later steps' calendar length UNCHANGED", () => {
    const out = planCarryForward({ steps: ladder, injectionsPerWeek: 4, deliveredCount: 11, daysSpentInCurrentPhase: 6 });
    expect(out[1].durationDays).toBe(14);
  });

  it("keeps an open-ended final step null", () => {
    const out = planCarryForward({ steps: ladder, injectionsPerWeek: 4, deliveredCount: 11, daysSpentInCurrentPhase: 6 });
    expect(out[out.length - 1].durationDays).toBeNull();
  });

  it("gives a phase entered but not yet dosed its FULL length", () => {
    const out = planCarryForward({ steps: ladder, injectionsPerWeek: 4, deliveredCount: 8, daysSpentInCurrentPhase: 0 });
    expect(out[0].dose).toBe("400");
    expect(out[0].durationDays).toBe(14);
  });

  it("floors the current step at 1 day rather than zero or negative", () => {
    const out = planCarryForward({ steps: ladder, injectionsPerWeek: 4, deliveredCount: 11, daysSpentInCurrentPhase: 99 });
    expect(out[0].durationDays).toBe(1);
  });

  it("is a no-op for a protocol with no titration steps", () => {
    expect(planCarryForward({ steps: [], injectionsPerWeek: 4, deliveredCount: 5, daysSpentInCurrentPhase: 2 })).toEqual([]);
  });

  it("copies the ladder unchanged when the old frequency is unknown", () => {
    const out = planCarryForward({ steps: ladder, injectionsPerWeek: null, deliveredCount: 11, daysSpentInCurrentPhase: 6 });
    expect(out.map((s) => s.dose)).toEqual(["200", "400", "600", "800"]);
  });

  it("REGRESSION: speeding up must not walk the ladder backwards", () => {
    // Editing in place at 7x/week re-derives targets to [14,14,14,null]; 11
    // delivered would resolve to step 0 — a dose already ramped past.
    const out = planCarryForward({ steps: ladder, injectionsPerWeek: 4, deliveredCount: 11, daysSpentInCurrentPhase: 6 });
    expect(out[0].dose).toBe("400"); // not "200"
  });

  it("makes the call-site hazard EXECUTABLE: old frequency vs new gives different steps", () => {
    // The previous two tests document the failure directions but pass for the
    // same reason as the happy path, because this function is never handed the
    // new frequency. This one actually exercises the hazard: it pins what the
    // WRONG argument produces, so it fails loudly if someone "simplifies" the
    // call site to pass the new frequency, or makes this frequency-independent.
    const args = { steps: ladder, deliveredCount: 11, daysSpentInCurrentPhase: 6 };
    expect(planCarryForward({ ...args, injectionsPerWeek: 4 })[0].dose).toBe("400"); // OLD — correct
    expect(planCarryForward({ ...args, injectionsPerWeek: 7 })[0].dose).toBe("200"); // NEW — walks backwards
    expect(planCarryForward({ ...args, injectionsPerWeek: 2 })[0].dose).toBe("600"); // NEW — skips a step
  });

  it("REGRESSION: slowing down must not skip a ramp step", () => {
    // Editing in place at 2x/week re-derives targets to [4,4,4,null]; 11
    // delivered would resolve to step 2 — an escalation never earned.
    const out = planCarryForward({ steps: ladder, injectionsPerWeek: 4, deliveredCount: 11, daysSpentInCurrentPhase: 6 });
    expect(out[0].dose).toBe("400"); // not "600"
  });
});

describe("daysSpentInPhase", () => {
  // 4x/week over 14-day steps -> targets [8,8,8,null]. Phase 1 begins at the
  // 9th delivered dose, i.e. index 8 in the ascending day list.
  const days = (n: number, from = 1) =>
    Array.from({ length: n }, (_, i) => `2026-06-${String(from + i).padStart(2, "0")}`);

  it("measures from the FIRST dose of the current phase, not the protocol start", () => {
    // 11 doses on consecutive days from 06-01: dose 9 (index 8) fell on 06-09.
    // Today 06-15 -> 6 days into phase 1.
    expect(
      daysSpentInPhase({ steps: ladder, injectionsPerWeek: 4, deliveredDayKeys: days(11), todayKey: "2026-06-15" }),
    ).toBe(6);
  });

  it("is 0 for a phase entered but not yet dosed", () => {
    // Exactly 8 delivered completes phase 0; phase 1 has no dose yet.
    expect(
      daysSpentInPhase({ steps: ladder, injectionsPerWeek: 4, deliveredDayKeys: days(8), todayKey: "2026-06-15" }),
    ).toBe(0);
  });

  it("is 0 on the day the phase's first dose was taken", () => {
    expect(
      daysSpentInPhase({ steps: ladder, injectionsPerWeek: 4, deliveredDayKeys: days(9), todayKey: "2026-06-09" }),
    ).toBe(0);
  });

  it("never returns negative when the clock is behind the dose log", () => {
    expect(
      daysSpentInPhase({ steps: ladder, injectionsPerWeek: 4, deliveredDayKeys: days(11), todayKey: "2026-06-01" }),
    ).toBe(0);
  });

  it("is 0 with no steps, no frequency, or no doses", () => {
    expect(daysSpentInPhase({ steps: [], injectionsPerWeek: 4, deliveredDayKeys: days(5), todayKey: "2026-06-15" })).toBe(0);
    expect(daysSpentInPhase({ steps: ladder, injectionsPerWeek: null, deliveredDayKeys: days(5), todayKey: "2026-06-15" })).toBe(0);
    expect(daysSpentInPhase({ steps: ladder, injectionsPerWeek: 4, deliveredDayKeys: [], todayKey: "2026-06-15" })).toBe(0);
  });

  it("feeds planCarryForward: the resumed step is shortened by the days actually served", () => {
    const spent = daysSpentInPhase({ steps: ladder, injectionsPerWeek: 4, deliveredDayKeys: days(11), todayKey: "2026-06-15" });
    const out = planCarryForward({ steps: ladder, injectionsPerWeek: 4, deliveredCount: 11, daysSpentInCurrentPhase: spent });
    expect(out[0].dose).toBe("400");
    expect(out[0].durationDays).toBe(8); // 14 - 6
  });
});

describe("endDateOnClose", () => {
  it("sets endDate to today when a live protocol is marked completed", () => {
    expect(endDateOnClose({ wasStatus: "active", nowStatus: "completed", currentEndDate: null, todayKey: "2026-08-15" }))
      .toBe("2026-08-15");
  });

  it("CLAMPS a planned end date that is still in the future", () => {
    // A 12-week course planned to 2026-09-28 and closed early on 08-15. Left
    // alone, slot generation keeps emitting until September and
    // every ghost ages into a false miss.
    expect(endDateOnClose({ wasStatus: "active", nowStatus: "completed", currentEndDate: "2026-09-28", todayKey: "2026-08-15" }))
      .toBe("2026-08-15");
  });

  it("leaves an endDate that is already in the past alone", () => {
    // A course that ran to its planned end is already honest — do not move it.
    expect(endDateOnClose({ wasStatus: "active", nowStatus: "completed", currentEndDate: "2026-07-01", todayKey: "2026-08-15" }))
      .toBeNull();
  });

  it("leaves an endDate of exactly today alone", () => {
    expect(endDateOnClose({ wasStatus: "active", nowStatus: "completed", currentEndDate: "2026-08-15", todayKey: "2026-08-15" }))
      .toBeNull();
  });

  it("does nothing when the protocol was ALREADY completed", () => {
    // Editing a closed protocol's name must not silently re-stamp its end date.
    expect(endDateOnClose({ wasStatus: "completed", nowStatus: "completed", currentEndDate: "2026-09-28", todayKey: "2026-08-15" }))
      .toBeNull();
  });

  it("does nothing for pause — a paused course may resume", () => {
    expect(endDateOnClose({ wasStatus: "active", nowStatus: "paused", currentEndDate: null, todayKey: "2026-08-15" }))
      .toBeNull();
  });

  it("does nothing when staying active", () => {
    expect(endDateOnClose({ wasStatus: "active", nowStatus: "active", currentEndDate: "2026-09-28", todayKey: "2026-08-15" }))
      .toBeNull();
  });
});
