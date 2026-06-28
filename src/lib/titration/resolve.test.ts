import { describe, it, expect } from "vitest";
import { resolveTitration } from "./resolve";
import type { ResolveInput } from "./types";

const d = (s: string) => new Date(s + "T00:00:00");
const dt = (s: string) => new Date(s); // local datetime, e.g. "2026-06-18T19:00:00"
const wk = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "TH"] }, times: [] }]);
const wkTimed = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "TH"] }, times: ["08:00"] }]);

function input(over: Partial<ResolveInput>): ResolveInput {
  return {
    doseBasis: "per_week", steps: [
      { stepIndex: 0, dose: "8", doseInputUnit: "mg", durationDays: 14 }, // 4 doses @ 8mg/wk
      { stepIndex: 1, dose: "12", doseInputUnit: "mg", durationDays: null },
    ],
    fallbackDose: null, fallbackUnit: "mg", scheduleRule: wk, rebaseMode: "fixed_anchor",
    startDate: d("2026-06-15"), endDate: null, injectionsPerWeek: 2, delivered: [],
    skipped: [], range: { start: d("2026-06-15"), end: d("2026-07-20") },
    now: d("2026-06-15"), adherenceWindowMin: 120, ...over,
  };
}

describe("resolveTitration", () => {
  it("per_week derives per-injection dose (8mg/wk ÷ 2 = 4mg)", () => {
    const r = resolveTitration(input({}));
    expect(r.slots[0].perInjectionValue).toBe("4");
    expect(r.slots[0].perInjectionUnit).toBe("mg");
    expect(r.slots[0].phaseIndex).toBe(0);
  });
  it("fixed_anchor re-anchors a past Sunday-start week: Sun/Tue/Thu all taken + rebased", () => {
    // Tα1-like: base M/W/F, started Sunday with the dose, dosed Sun/Tue/Thu, now is
    // the following Saturday. The historical week must render as the SHIFTED schedule
    // (taken on its own anchor) — not the raw grid with off-schedule/missed.
    const mwf = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "WE", "FR"] }, times: [] }]);
    const delivered = [d("2026-06-14"), d("2026-06-16"), d("2026-06-18")].map((t, i) => ({ id: `${i}`, takenAt: t }));
    const r = resolveTitration(input({
      doseBasis: "per_injection", steps: [], fallbackDose: "0.5", fallbackUnit: "mg",
      scheduleRule: mwf, rebaseMode: "fixed_anchor", startDate: d("2026-06-14"),
      injectionsPerWeek: 3, delivered, now: d("2026-06-20"),
      range: { start: d("2026-06-14"), end: d("2026-06-21") },
    }));
    expect(r.slots.map((s) => s.date.getDate())).toEqual([14, 16, 18]); // Sun/Tue/Thu, no Mon-missed, no Sat-phantom
    expect(r.slots.every((s) => s.status === "taken")).toBe(true);
    expect(r.slots.every((s) => s.rebased === true)).toBe(true);
  });
  it("phase stays 0 until 4 doses delivered (count-based), then steps up to 12mg/wk = 6mg", () => {
    const delivered = [d("2026-06-15"), d("2026-06-18"), d("2026-06-22"), d("2026-06-25")].map((t, i) => ({ id: `${i}`, takenAt: t }));
    const r = resolveTitration(input({ delivered, now: d("2026-06-26") }));
    const stepUp = r.slots.find((s) => s.phaseIndex === 1);
    expect(stepUp?.perInjectionValue).toBe("6"); // 12 ÷ 2
    expect(r.stepUpDates.length).toBeGreaterThan(0);
  });
  it("a skipped dose does NOT advance the phase (phase stretches)", () => {
    // deliver only 3 of the first 4 → still phase 0 on the 5th slot
    const delivered = [d("2026-06-15"), d("2026-06-18"), d("2026-06-22")].map((t, i) => ({ id: `${i}`, takenAt: t }));
    const r = resolveTitration(input({ delivered, now: d("2026-06-26") }));
    const futurePhase0 = r.slots.filter((s) => s.phaseIndex === 0 && s.isProjected);
    expect(futurePhase0.length).toBeGreaterThan(0); // still completing phase 0
  });
  it("no steps → non-titration fallback dose, phaseIndex null", () => {
    const r = resolveTitration(input({ steps: [], doseBasis: "per_injection", fallbackDose: "250", fallbackUnit: "mcg" }));
    expect(r.slots[0].perInjectionValue).toBe("250");
    expect(r.slots[0].phaseIndex).toBeNull();
    expect(r.phaseProgress).toBeNull();
  });
  it("null startDate → non-titration fallback, per_week target still divided (no crash)", () => {
    // startDate null → not titrating → uses the Protocol.targetDose fallback.
    // The fixture is per_week with injectionsPerWeek=2, so the weekly "5" is
    // divided to "2.5" — a per_week value is NEVER emitted undivided (spec §6).
    const r = resolveTitration(input({ startDate: null, fallbackDose: "5" }));
    expect(r.slots[0].perInjectionValue).toBe("2.5");
    expect(r.slots[0].phaseIndex).toBeNull();
  });
  it("per_week with unresolved frequency must NOT emit a raw weekly value (fails safe, spec §6)", () => {
    // injectionsPerWeek null → the weekly dose can't be divided. Emitting the
    // raw "8" would be a 2–7× displayed/loggable overdose, so the resolver
    // yields "" and callers fail safe (no prefilled dose), never NaN nor weekly.
    const r = resolveTitration(input({ injectionsPerWeek: null, fallbackDose: "8" }));
    expect(r.slots[0].perInjectionValue).toBe(""); // NOT "8" — undivided weekly is forbidden
  });

  // B1 — phaseProgress reflects the STATE AT NOW (count of doses delivered by now),
  // NOT the loop's terminal iteration over a long projected range.
  it("phaseProgress is computed at now, not the projected tail of the range", () => {
    const threePhase = [
      { stepIndex: 0, dose: "8", doseInputUnit: "mg" as const, durationDays: 14 },  // 4 doses @ 2/wk
      { stepIndex: 1, dose: "12", doseInputUnit: "mg" as const, durationDays: 14 }, // 4 doses
      { stepIndex: 2, dose: "16", doseInputUnit: "mg" as const, durationDays: null },
    ];
    // 5 delivered, all before now; targets = [4,4,null] → 5th dose is the 1st of phase 1.
    const delivered = [
      d("2026-06-15"), d("2026-06-18"), d("2026-06-22"), d("2026-06-25"), d("2026-06-29"),
    ].map((t, i) => ({ id: `${i}`, takenAt: t }));
    const r = resolveTitration(input({
      steps: threePhase, delivered, now: d("2026-06-30"),
      range: { start: d("2026-06-15"), end: d("2026-08-31") }, // ~2 months past now
    }));
    expect(r.phaseProgress).toEqual({ phaseIndex: 1, deliveredInPhase: 1, phaseCount: 3, targetInPhase: 4 });
  });

  // B1b (Reta prod bug) — a dose logged EARLIER on the now-day must count toward
  // phaseProgress. today.ts passes `now` as local midnight (startOfDay), so a strict
  // `takenAt <= now` dropped a dose already taken today → the card read "0/10" right
  // after logging. Progress is counted through the END of the now-day instead.
  it("phaseProgress counts a dose delivered earlier on the now-day (not just before midnight)", () => {
    const reta = [
      { stepIndex: 0, dose: "0.5", doseInputUnit: "mg" as const, durationDays: 7 },  // target 3 @2.5/wk
      { stepIndex: 1, dose: "1", doseInputUnit: "mg" as const, durationDays: 28 },    // target 10
      { stepIndex: 2, dose: "2", doseInputUnit: "mg" as const, durationDays: 28 },    // target 10
      { stepIndex: 3, dose: "3", doseInputUnit: "mg" as const, durationDays: null },
    ];
    // 4 doses; the 4th is at 10:31 on the now-day. now is passed as midnight (as today.ts does).
    const delivered = [
      dt("2026-06-18T19:00:00"), dt("2026-06-21T21:57:00"),
      dt("2026-06-24T07:15:00"), dt("2026-06-27T10:31:00"), // today, after midnight
    ].map((t, i) => ({ id: `${i}`, takenAt: t }));
    const r = resolveTitration(input({
      doseBasis: "per_injection", steps: reta, fallbackDose: "0.5", fallbackUnit: "mg",
      scheduleRule: JSON.stringify([{ dayPattern: { kind: "interval", everyDays: 3 }, times: [] }]),
      rebaseMode: "rolling", startDate: d("2026-06-18"), injectionsPerWeek: 2.5,
      delivered, now: d("2026-06-27"), // local midnight, exactly as getTodayDoses passes
      range: { start: d("2026-06-27"), end: d("2026-06-27") },
    }));
    // 4 delivered (incl. today's) → phase 1 (1mg), 1 into the 10-dose phase. NOT 0/10.
    expect(r.phaseProgress).toEqual({ phaseIndex: 1, deliveredInPhase: 1, phaseCount: 4, targetInPhase: 10 });
  });

  // I1 — an ad-hoc (unscheduled, unmatched) dose still counts toward progression.
  it("4 on-grid + 1 ad-hoc dose advance the phase (ad-hoc counts)", () => {
    const onGrid = [d("2026-06-15"), d("2026-06-18"), d("2026-06-22"), d("2026-06-25")];
    // Ad-hoc dose on a Wed (06-24) far from any Mon/Thu slot's 120-min window.
    const adHoc = d("2026-06-24");
    const delivered = [...onGrid, adHoc].map((t, i) => ({ id: `${i}`, takenAt: t }));
    const r = resolveTitration(input({ delivered, now: d("2026-06-26") })); // phase0 target = 4
    // A post-now projected slot is in phase 1 after the 5 deliveries.
    const projected = r.slots.find((s) => s.isProjected);
    expect(projected?.phaseIndex).toBe(1);
    expect(r.phaseProgress?.phaseIndex).toBe(1);
  });

  // B0 — the resolver surfaces which DoseLog matched each slot (timeline prerequisite).
  it("matchedLogId exposes the matched delivered dose; unmatched/future slots are null", () => {
    // One delivered dose on the first MO slot (within the ±120-min window) →
    // slot[0].matchedLogId is that dose's id; later/unmatched slots are null.
    const delivered = [{ id: "L1", takenAt: d("2026-06-15") }];
    const r = resolveTitration(input({ delivered, now: d("2026-06-16") }));
    expect(r.slots[0].matchedLogId).toBe("L1");
    expect(r.slots.slice(1).every((s) => s.matchedLogId === null)).toBe(true);
  });

  // I2 — the phase cursor is range-independent: doses before range.start still count.
  it("4 doses delivered before range.start → first in-range slot is phase 1", () => {
    const before = [d("2026-06-08"), d("2026-06-09"), d("2026-06-10"), d("2026-06-11")]
      .map((t, i) => ({ id: `${i}`, takenAt: t }));
    const r = resolveTitration(input({ delivered: before })); // range.start = startDate = 06-15
    expect(r.slots[0].phaseIndex).toBe(1); // 4 prior deliveries already completed phase 0
  });

  // FIX #4 — an UNTIMED slot must match any dose on the SAME CALENDAR DAY, not
  // by ±adherence-window vs local-midnight. A 19:00 dose on an untimed Thursday
  // slot is ~19h from slotStart (midnight) and used to never match → "missed".
  it("untimed slot matches a same-day daytime dose (was falsely missed)", () => {
    const delivered = [{ id: "T1", takenAt: dt("2026-06-18T19:00:00") }]; // Thursday 7pm
    const r = resolveTitration(input({ delivered, now: d("2026-06-19") }));
    const thu = r.slots.find((s) => s.date.getTime() === d("2026-06-18").getTime());
    expect(thu?.status).toBe("taken");
    expect(thu?.matchedLogId).toBe("T1");
  });

  // Same-day rule — a TIMED slot matches a dose logged the SAME calendar day
  // regardless of the clock time (no ±adherence-window gate). A dose 3h from the
  // 08:00 slot on the same day now reads "taken" (the user logs when they dosed,
  // not to the minute). (Was: ±window rejected it → falsely "missed".)
  it("timed slot matches a same-day dose regardless of clock time", () => {
    const delivered = [{ id: "L1", takenAt: dt("2026-06-15T11:00:00") }]; // 3h after 08:00, same day
    const r = resolveTitration(input({ scheduleRule: wkTimed, delivered, now: d("2026-06-16") }));
    expect(r.slots[0].time).toBe("08:00");
    expect(r.slots[0].matchedLogId).toBe("L1");
    expect(r.slots[0].status).toBe("taken");
  });

  // Same-day is the GATE, not "any dose": under ROLLING (no rebase) a dose on a
  // DIFFERENT day does NOT match a slot. (Under fixed_anchor a different-day dose
  // instead triggers a rebase that moves a slot onto that day — covered above.)
  it("rolling: timed slot does NOT match a different-day dose", () => {
    const delivered = [{ id: "X", takenAt: dt("2026-06-14T20:00:00") }]; // Sunday, slot is Mon 08:00
    const r = resolveTitration(input({ scheduleRule: wkTimed, rebaseMode: "rolling", delivered, now: d("2026-06-16") }));
    expect(r.slots[0].time).toBe("08:00");
    expect(r.slots[0].matchedLogId).toBeNull();
  });

  // Multi-time day — each slot takes its CLOSEST same-day dose so a morning/evening
  // pair lands on the right slots (the time breaks ties; it does not gate matching).
  it("multi-time day assigns each slot its closest same-day dose", () => {
    const twice = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO"] }, times: ["08:00", "20:00"] }]);
    const delivered = [
      { id: "am", takenAt: dt("2026-06-15T09:30:00") }, // Mon morning → 08:00
      { id: "pm", takenAt: dt("2026-06-15T19:30:00") }, // Mon evening → 20:00
    ];
    const r = resolveTitration(input({ scheduleRule: twice, delivered, now: d("2026-06-16"), injectionsPerWeek: 2 }));
    expect(r.slots.find((s) => s.time === "08:00")?.matchedLogId).toBe("am");
    expect(r.slots.find((s) => s.time === "20:00")?.matchedLogId).toBe("pm");
  });

  // GHK Sat-dose prod bug — a fixed_anchor TIMED slot REBASED onto a dose's actual
  // day must match that dose by same-calendar-day even when it's >adherenceWindow
  // from the retained clock time. A dose taken Tue 17:39 (off the Mon/Thu @20:00
  // grid) rebases the Mon slot onto Tue; 17:39 is 141min from 20:00 (> 120 window),
  // but the rebased Tue slot must still read "taken" (was falsely "off-schedule").
  it("rebased timed slot matches a same-day dose outside the ±window", () => {
    const timed = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "TH"] }, times: ["20:00"] }]);
    const delivered = [{ id: "T", takenAt: dt("2026-06-23T17:39:00") }]; // Tue 17:39, off-grid
    const r = resolveTitration(input({
      doseBasis: "per_injection", steps: [], fallbackDose: "1000", fallbackUnit: "mcg",
      scheduleRule: timed, rebaseMode: "fixed_anchor", startDate: d("2026-06-15"),
      injectionsPerWeek: 2, delivered, now: d("2026-06-25"),
      range: { start: d("2026-06-22"), end: d("2026-06-28") },
    }));
    const tue = r.slots.find((s) => s.date.getTime() === d("2026-06-23").getTime());
    expect(tue?.rebased).toBe(true);
    expect(tue?.status).toBe("taken");
    expect(tue?.matchedLogId).toBe("T");
  });

  // Reta prod bug (2026-06-28) — the DB returns steps in arbitrary order (editing a
  // step reorders the rows). phaseTargets sorts internally, but the per-slot dose
  // lookup was a raw inp.steps[phaseIndex] → it rendered array-position-1 (the 2mg
  // step) while the phase cursor was on stepIndex 1 (the 1mg step). The per-slot
  // dose must be addressed by stepIndex, regardless of array order.
  it("per-slot dose is addressed by stepIndex even when steps are out of DB order", () => {
    const scrambled = [
      { stepIndex: 0, dose: "0.5", doseInputUnit: "mg" as const, durationDays: 7 },
      { stepIndex: 2, dose: "2", doseInputUnit: "mg" as const, durationDays: 28 },  // array pos 1 = WRONG dose
      { stepIndex: 3, dose: "3", doseInputUnit: "mg" as const, durationDays: null },
      { stepIndex: 1, dose: "1", doseInputUnit: "mg" as const, durationDays: 28 },  // the real phase-1 dose
    ];
    // 4 deliveries @ 2/wk: phase0 target = round(7/7·2)=2 → cursor is in phase 1.
    const delivered = [d("2026-06-15"), d("2026-06-18"), d("2026-06-22"), d("2026-06-25")].map((t, i) => ({ id: `${i}`, takenAt: t }));
    const r = resolveTitration(input({
      doseBasis: "per_injection", steps: scrambled, fallbackDose: "0.5",
      delivered, now: d("2026-06-26"), range: { start: d("2026-06-15"), end: d("2026-07-20") },
    }));
    const phase1 = r.slots.filter((s) => s.phaseIndex === 1);
    expect(phase1.length).toBeGreaterThan(0);
    expect(phase1.every((s) => s.perInjectionValue === "1")).toBe(true); // the 1mg step, NOT "2"
  });
});
