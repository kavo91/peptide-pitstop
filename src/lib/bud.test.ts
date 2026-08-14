/**
 * The runtime zone here is whatever `vitest.config.ts` pins (a positive UTC
 * offset). Several cases exist specifically to pin behaviour where the local
 * day and the UTC day disagree — running them in UTC would pass vacuously.
 */
import { describe, expect, it } from "vitest";
import {
  BUD_APPROACHING_DAYS,
  BUD_DEFAULT_DAYS,
  budDayKey,
  budStatus,
  budWarning,
  beyondUseDateFrom,
  resolveBudDays,
} from "./bud";

describe("resolveBudDays", () => {
  it("falls back to the 28-day global default when the peptide sets none", () => {
    expect(resolveBudDays({})).toBe(BUD_DEFAULT_DAYS);
    expect(resolveBudDays({ peptideDefaultBudDays: null })).toBe(28);
  });

  it("prefers the peptide-level default over the global one", () => {
    expect(resolveBudDays({ peptideDefaultBudDays: 14 })).toBe(14);
  });

  it("prefers an explicit per-preparation override over both", () => {
    expect(resolveBudDays({ peptideDefaultBudDays: 14, overrideDays: 60 })).toBe(60);
  });

  it("ignores non-positive and non-finite values rather than producing an absurd BUD", () => {
    expect(resolveBudDays({ peptideDefaultBudDays: 0 })).toBe(28);
    expect(resolveBudDays({ peptideDefaultBudDays: -5 })).toBe(28);
    expect(resolveBudDays({ overrideDays: Number.NaN, peptideDefaultBudDays: 14 })).toBe(14);
  });

  it("floors fractional days — a BUD is a whole-day concept", () => {
    expect(resolveBudDays({ overrideDays: 10.9 })).toBe(10);
  });
});

describe("beyondUseDateFrom — convention 1 (date-only, UTC midnight)", () => {
  it("lands on UTC midnight so it matches every other date-only field", () => {
    const bud = beyondUseDateFrom(new Date("2027-02-22T00:00:00.000Z"), 28);
    expect(bud.toISOString()).toBe("2027-03-22T00:00:00.000Z");
    expect(bud.getTime() % 86_400_000).toBe(0);
  });

  /**
   * The regression that motivated the rewrite. Early morning in a UTC+10 zone
   * is still the PREVIOUS day in UTC. Adding 28 × 86400000 to the instant kept
   * the 22:15 UTC time-of-day and produced a BUD one day early. Deriving from
   * the LOCAL day fixes it.
   */
  it("uses the LOCAL day of preparation, not the UTC instant", () => {
    const recon = new Date("2027-03-13T22:15:00.000Z"); // 14 Mar 08:15 at UTC+10
    expect(budDayKey(beyondUseDateFrom(recon, 28))).toBe("2027-04-11");
  });

  it("normalises month and year overflow", () => {
    expect(budDayKey(beyondUseDateFrom(new Date("2027-12-20T03:00:00.000Z"), 28))).toBe("2028-01-17");
  });
});

describe("budStatus — day-key comparison, never instant subtraction", () => {
  const bud = new Date("2027-03-22T00:00:00.000Z");

  it("reports ok while comfortably inside the window", () => {
    const s = budStatus({ beyondUseDate: bud, now: new Date("2027-03-01T00:00:00.000Z") });
    expect(s.state).toBe("ok");
    expect(s.daysRemaining).toBe(21);
  });

  it("reports approaching inside the T-3 window", () => {
    const s = budStatus({ beyondUseDate: bud, now: new Date("2027-03-20T00:00:00.000Z") });
    expect(s.state).toBe("approaching");
    expect(s.daysRemaining).toBe(2);
  });

  it("treats the BUD day ITSELF as approaching, not passed — 'use by the 22nd' includes the 22nd", () => {
    const s = budStatus({ beyondUseDate: bud, now: new Date("2027-03-22T01:00:00.000Z") });
    expect(s.state).toBe("approaching");
    expect(s.daysRemaining).toBe(0);
  });

  it("reports passed from the following local day", () => {
    const s = budStatus({ beyondUseDate: bud, now: new Date("2027-03-23T02:00:00.000Z") });
    expect(s.state).toBe("passed");
    expect(s.daysRemaining).toBe(-1);
  });

  /**
   * Late evening in a UTC+10 zone is already the NEXT day locally while UTC is
   * still on the previous one. Instant subtraction reports the stale day here.
   */
  it("uses the viewer's LOCAL day for 'today', not the UTC day", () => {
    // 23:30 local on the BUD day — still the BUD day.
    expect(budStatus({ beyondUseDate: bud, now: new Date("2027-03-22T13:30:00.000Z") }).daysRemaining).toBe(0);
    // 00:30 local the next day — locally past it.
    expect(budStatus({ beyondUseDate: bud, now: new Date("2027-03-22T14:30:00.000Z") }).daysRemaining).toBe(-1);
  });

  it("counts a long overrun correctly", () => {
    const s = budStatus({
      beyondUseDate: bud,
      now: new Date("2027-04-06T12:51:00.000Z"), // 22:51 local, 15 days later
    });
    expect(s.state).toBe("passed");
    expect(s.daysRemaining).toBe(-15);
  });

  it("reports unknown when no beyond-use date was ever recorded", () => {
    const s = budStatus({ beyondUseDate: null, now: new Date() });
    expect(s.state).toBe("unknown");
    expect(s.daysRemaining).toBeNull();
  });
});

describe("budWarning", () => {
  const bud = new Date("2027-03-22T00:00:00.000Z");

  it("emits nothing while the preparation is well inside its window", () => {
    expect(budWarning({ beyondUseDate: bud, now: new Date("2027-03-01T00:00:00.000Z") })).toBeNull();
  });

  it("emits nothing when no beyond-use date is recorded — absence is not a breach", () => {
    expect(budWarning({ beyondUseDate: null, now: new Date() })).toBeNull();
  });

  it("emits a warn-severity notice when approaching", () => {
    const w = budWarning({ beyondUseDate: bud, now: new Date("2027-03-20T00:00:00.000Z") });
    expect(w?.code).toBe("PREPARATION_BUD_APPROACHING");
    expect(w?.severity).toBe("warn");
    expect(w?.message).toContain("2 days");
  });

  it("says 'today' rather than 'in 0 days' on the BUD day", () => {
    const w = budWarning({ beyondUseDate: bud, now: new Date("2027-03-22T01:00:00.000Z") });
    expect(w?.message).toContain("today");
    expect(w?.message).not.toContain("0 days");
  });

  it("singularises one day", () => {
    const w = budWarning({ beyondUseDate: bud, now: new Date("2027-03-21T01:00:00.000Z") });
    expect(w?.message).toContain("in 1 day.");
  });

  it("emits a warn-severity notice when passed", () => {
    const w = budWarning({ beyondUseDate: bud, now: new Date("2027-04-06T00:00:00.000Z") });
    expect(w?.code).toBe("PREPARATION_PAST_BUD");
    expect(w?.message).toContain("15 days");
  });

  it("NEVER blocks — a dose already taken must always be loggable", () => {
    for (const now of ["2027-03-20", "2027-04-06", "2028-01-01"].map((d) => new Date(d))) {
      expect(budWarning({ beyondUseDate: bud, now })?.severity).not.toBe("block");
    }
  });

  it("honours a caller-supplied approaching window", () => {
    const w = budWarning({
      beyondUseDate: bud,
      now: new Date("2027-03-15T00:00:00.000Z"),
      approachingWithinDays: 10,
    });
    expect(w?.code).toBe("PREPARATION_BUD_APPROACHING");
    expect(BUD_APPROACHING_DAYS).toBe(3);
  });
});
