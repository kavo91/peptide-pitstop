import { describe, it, expect } from "vitest";
import { BODY_COPY, intervalSentence, CAUSAL_VERBS } from "./bodycomp-copy";

describe("bodycomp copy", () => {
  it("contains no causal verbs anywhere", () => {
    const all = [
      ...Object.values(BODY_COPY),
      intervalSentence({
        metric: "Fat mass",
        deltaKg: -0.9,
        days: 91,
        tier: "indeterminate",
        technical: 0.29,
        practical: 1.2,
        compounds: ["A", "B"],
        intakeLogged: false,
      }),
    ]
      .join(" ")
      .toLowerCase();
    for (const v of CAUSAL_VERBS) expect(all).not.toMatch(new RegExp(`\\b${v}\\b`));
  });

  it("carries the life-event section copy (lint above covers it)", () => {
    expect(BODY_COPY.lifeEventsTitle).toBe("Illness and travel windows");
    expect(BODY_COPY.lifeEventsIntro).toContain("excluded from interval medians");
    for (const k of ["lifeEventsLegend", "lifeEventsEmpty", "lifeEventLabelHint", "lifeEventSaved", "lifeEventDeleteConfirm"] as const) {
      expect(BODY_COPY[k].length).toBeGreaterThan(0);
    }
  });

  it("renders the interval sentence with 'were logged during' and the intake gap", () => {
    const s = intervalSentence({
      metric: "Fat mass",
      deltaKg: -0.9,
      days: 91,
      tier: "indeterminate",
      technical: 0.29,
      practical: 1.2,
      compounds: ["A", "B"],
      intakeLogged: false,
    });
    expect(s).toContain("Fat mass changed by −0.9 kg over 91 days");
    expect(s).toContain("A and B were logged during this interval");
    expect(s).toContain("intake was not logged");
  });

  it("uses the typographic minus like the tables, and a plus for gains", () => {
    const base = { metric: "Fat mass", days: 30, tier: "within_noise" as const, technical: 0.35, practical: 0.67, compounds: [], intakeLogged: true };
    expect(intervalSentence({ ...base, deltaKg: -1.0 })).toContain("changed by −1.0 kg");
    expect(intervalSentence({ ...base, deltaKg: 0.2 })).toContain("changed by +0.2 kg");
  });

  it("a demoted flag is worded from the undemoted tier and says it was demoted — never 'not the practical LSC' for a change that exceeds it", () => {
    // |Δ| 1.00 kg > practical 0.67 kg, demoted exceeds_lsc → indeterminate for reduced comparability.
    const s = intervalSentence({
      metric: "Fat mass", deltaKg: -1.0, days: 90, tier: "indeterminate", technical: 0.35, practical: 0.67, compounds: [], intakeLogged: true,
      demoted: true, rawTier: "exceeds_lsc", comparabilityReasons: ["noCaffeine: not recorded on one scan", "activeTravel: not recorded on one scan"],
    });
    expect(s).toContain("this exceeds the practical LSC (0.67 kg)");
    expect(s).not.toContain("but not the practical LSC");
    expect(s).toContain("the flag is demoted to indeterminate for reduced comparability (noCaffeine: not recorded on one scan; activeTravel: not recorded on one scan)");
    for (const v of CAUSAL_VERBS) expect(s.toLowerCase()).not.toMatch(new RegExp(`\\b${v}\\b`));

    // Clinic precision case: |Δ| 1.00 kg > technical 0.68 kg, raw indeterminate demoted to within_noise.
    const t = intervalSentence({
      metric: "Fat mass", deltaKg: -1.0, days: 90, tier: "within_noise", technical: 0.68, practical: 1.29, compounds: [], intakeLogged: true,
      demoted: true, rawTier: "indeterminate", comparabilityReasons: ["fasted: differs"],
    });
    expect(t).toContain("this exceeds the technical LSC (0.68 kg) but not the practical LSC (1.29 kg)");
    expect(t).not.toContain("within the technical LSC");
    expect(t).toContain("demoted to within noise");
  });
});
