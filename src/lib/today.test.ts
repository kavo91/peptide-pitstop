import { describe, it, expect, afterEach } from "vitest";
import Decimal from "decimal.js";
import { resolveTitration } from "./titration/resolve";
import { buildResolveInput } from "./titration/from-protocol";
import { perInjectionDose } from "./titration/dose-basis";
import { startOfDay } from "./schedule/schedule";
import { classifyOverrideDays, dueSlotsForDay, dayKey } from "./today-overrides";

// getTodayDoses is DB-bound; these guard the exact resolver contract it relies
// on. today.ts builds its ResolveInput via buildResolveInput, then reads the
// slot matching the day/slot.time to set doseValue/doseUnit + alreadyLoggedToday.
const d = (s: string) => new Date(s + "T00:00:00");
const wk = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "TH"] }, times: [] }]);

describe("today dose resolution via resolver", () => {
  it("per_week 8mg/wk @ 2/wk shows 4mg per injection on the current slot", () => {
    const now = d("2026-06-15"); // a Monday
    const r = resolveTitration(
      buildResolveInput({
        protocol: {
          doseBasis: "per_week",
          targetDose: null,
          doseInputUnit: "mg",
          scheduleRule: wk,
          rebaseMode: "fixed_anchor",
          startDate: now,
          endDate: null,
          adherenceWindowMin: 120,
          steps: [{ stepIndex: 0, dose: new Decimal("8"), doseInputUnit: "mg", durationDays: null }],
        },
        deliveredLogs: [],
        range: { start: now, end: now },
        now,
      }),
    );
    const slot = r.slots.find((s) => (s.time ?? null) === null) ?? r.slots[0];
    expect(slot.perInjectionValue).toBe("4");
    expect(slot.perInjectionUnit).toBe("mg");
  });

  it("alreadyLoggedToday derives from resolved slot status 'taken'", () => {
    const now = d("2026-06-15");
    const r = resolveTitration(
      buildResolveInput({
        protocol: {
          doseBasis: "per_injection",
          targetDose: new Decimal("250"),
          doseInputUnit: "mcg",
          scheduleRule: wk,
          rebaseMode: "fixed_anchor",
          startDate: now,
          endDate: null,
          adherenceWindowMin: 120,
          steps: [],
        },
        // a log on the Monday slot → status taken
        deliveredLogs: [{ id: "a", takenAt: d("2026-06-15") }],
        range: { start: now, end: now },
        now,
      }),
    );
    const slot = r.slots.find((s) => (s.time ?? null) === null) ?? r.slots[0];
    expect(slot.status).toBe("taken");
    expect(slot.perInjectionValue).toBe("250"); // non-titration fallback, undivided
  });

  it("per_week whose schedule resolves no injections/week NEVER yields the raw weekly value (spec §6)", () => {
    // An empty/malformed scheduleRule parses to zero slots → dosesPerWeek is
    // null → the weekly dose can't be divided. The resolver emits no usable
    // slot, and today.ts's no-slot fallback (replicated below) must NOT leak the
    // raw weekly "8" into the patient-facing/loggable dose — it stays "".
    const now = d("2026-06-15");
    const protocol = {
      doseBasis: "per_week" as const,
      targetDose: new Decimal("8"),
      doseInputUnit: "mg" as const,
      scheduleRule: "", // zero slots → dosesPerWeek null
      rebaseMode: "fixed_anchor" as const,
      startDate: now,
      endDate: null,
      adherenceWindowMin: 120,
      steps: [{ stepIndex: 0, dose: new Decimal("8"), doseInputUnit: "mg" as const, durationDays: null }],
    };
    const input = buildResolveInput({ protocol, deliveredLogs: [], range: { start: now, end: now }, now });
    expect(input.injectionsPerWeek).toBeNull(); // no schedule → no frequency

    const r = resolveTitration(input);
    const slotResolved = r.slots.find((s) => (s.time ?? null) === null) ?? r.slots[0];

    // Replicate today.ts's no-slot fallback exactly (divide a per_week target;
    // omit if frequency can't resolve).
    let doseValue = slotResolved?.perInjectionValue ?? "";
    if (!slotResolved && protocol.targetDose != null) {
      const per = perInjectionDose({
        doseBasis: "per_week",
        value: protocol.targetDose.toString(),
        unit: "mg",
        injectionsPerWeek: input.injectionsPerWeek,
      });
      if (per) doseValue = per.value;
    }
    expect(doseValue).not.toBe("8"); // the hazard: raw weekly must never leak
    expect(doseValue).toBe(""); // fails safe — LogDoseForm guards on empty, disables submit
  });
});

// today.ts must surface resolver.phaseProgress on the due dose; this guards the
// resolver contract today.ts depends on for the label.
describe("phaseProgress for the Today label", () => {
  it("per_week titration reports phase position from delivered count", () => {
    const wkly = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "TH"] }, times: [] }]);
    const start = new Date("2026-06-15T00:00:00");
    const delivered = [new Date("2026-06-15"), new Date("2026-06-18")].map((t, i) => ({ id: `${i}`, takenAt: t }));
    const r = resolveTitration({
      doseBasis: "per_week",
      steps: [
        { stepIndex: 0, dose: "8", doseInputUnit: "mg", durationDays: 14 }, // 4 doses
        { stepIndex: 1, dose: "12", doseInputUnit: "mg", durationDays: null },
      ],
      fallbackDose: null, fallbackUnit: "mg", scheduleRule: wkly, rebaseMode: "fixed_anchor",
      startDate: start, endDate: null, injectionsPerWeek: 2, delivered, skipped: [],
      range: { start, end: start }, now: new Date("2026-06-19T00:00:00"), adherenceWindowMin: 120,
    });
    expect(r.phaseProgress).toEqual({ phaseIndex: 0, phaseCount: 2, deliveredInPhase: 2, targetInPhase: 4 });
  });
});

// ── WS6: today.ts rebase-override classifier — TZ hardening ───────────────────
// Regression for the prod bug fixed by container TZ=Australia/Brisbane: under a
// UTC runtime a Monday-local-midnight PlannedDose read back as Sunday, so an
// on-grid M/W/F routine row was misclassified as an off-grid rebase override and
// the dose showed "due" a day early. We force process.env.TZ so the assertion is
// deterministic regardless of the machine/CI timezone (Node v18+ re-reads TZ on
// each Date op). TZ is saved/restored so these never pollute the suite above.
describe("rebase-override classifier — TZ hardening (WS6)", () => {
  const ORIGINAL_TZ = process.env.TZ;
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  // M/W/F fixed_anchor protocol, in the entries-JSON format today.ts consumes.
  const mwf = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "WE", "FR"] }, times: [] }]);
  const proto = {
    id: "p-mwf",
    scheduleRule: mwf,
    rebaseMode: "fixed_anchor" as const,
    startDate: new Date("2026-06-01T00:00:00Z"),
    endDate: null,
  };
  // A row written as Monday 2026-06-15 local-midnight in Brisbane (+10:00) is the
  // absolute instant 2026-06-14T14:00:00Z. This is what the DB stores.
  const mondayLocalMidnightInstant = new Date("2026-06-14T14:00:00Z");

  it("under Australia/Brisbane: the Monday-midnight row is on-grid → NOT an override, and the protocol is NOT due the preceding Sunday", () => {
    process.env.TZ = "Australia/Brisbane";
    const overrideDays = classifyOverrideDays([proto], [{ protocolId: "p-mwf", scheduledAt: mondayLocalMidnightInstant }]);

    // The instant reads as Monday → on the M/W/F grid → no override recorded.
    expect(overrideDays.get("p-mwf")).toBeUndefined();

    // Mirror today.ts's due decision for the preceding Sunday (2026-06-14).
    const sunday = startOfDay(new Date("2026-06-14T12:00:00")); // Sunday, Brisbane
    const sundaySlots = dueSlotsForDay(mwf, overrideDays.get("p-mwf"), sunday, proto.startDate, proto.endDate);
    expect(sundaySlots).toHaveLength(0); // NOT due on Sunday — the correct behaviour

    // Sanity: it IS due on the Monday itself, via the live grid.
    const monday = startOfDay(new Date("2026-06-15T12:00:00"));
    expect(dueSlotsForDay(mwf, overrideDays.get("p-mwf"), monday, proto.startDate, proto.endDate)).toHaveLength(1);
  });

  it("documents the failure mode — under TZ=UTC the SAME instant shifts to Sunday and is misclassified as an off-grid override (dose due a day early)", () => {
    process.env.TZ = "UTC";
    const overrideDays = classifyOverrideDays([proto], [{ protocolId: "p-mwf", scheduledAt: mondayLocalMidnightInstant }]);

    // WHY this is the bug: under UTC the instant reads as Sunday 2026-06-14,
    // which is off the M/W/F grid, so the classifier wrongly records it as a
    // rebase override. The container TZ fix + the instrumentation.ts startup
    // guard are what prevent this in prod; this test pins the mechanism so a
    // future regression (or a TZ misconfig) is caught loudly.
    const sundayUtc = startOfDay(new Date("2026-06-14T12:00:00")); // Sunday, UTC
    expect(overrideDays.get("p-mwf")?.has(dayKey(sundayUtc))).toBe(true);
    const sundaySlots = dueSlotsForDay(mwf, overrideDays.get("p-mwf"), sundayUtc, proto.startDate, proto.endDate);
    expect(sundaySlots).toHaveLength(1); // the symptom: "due" a day early
  });

  // GHK-Cu prod bug (2026-06-26): a stray OFF-grid planned row sitting alongside
  // a valid ON-grid row in the same week must NOT be treated as a rebase. A real
  // confirmRebase deletes the on-grid rows, so a genuine rebase week is purely
  // off-grid. Previously a single off-grid row made the override set REPLACE the
  // whole grid → a genuinely-scheduled day (Friday) dropped off Today while the
  // dashboard + week view (live schedule) still showed it.
  it("a stray off-grid row alongside an on-grid row is NOT a rebase — the live grid still wins", () => {
    process.env.TZ = "Australia/Brisbane";
    // Monday 2026-06-15 (on-grid M/W/F) + a stray Tuesday 2026-06-16 (off-grid),
    // both stored as Brisbane local-midnight instants in the same week.
    const tuesdayLocalMidnightInstant = new Date("2026-06-15T14:00:00Z");
    const overrideDays = classifyOverrideDays([proto], [
      { protocolId: "p-mwf", scheduledAt: mondayLocalMidnightInstant },  // on-grid
      { protocolId: "p-mwf", scheduledAt: tuesdayLocalMidnightInstant }, // off-grid (stray)
    ]);
    // On-grid row present → NOT a genuine rebase → no override set recorded.
    expect(overrideDays.get("p-mwf")).toBeUndefined();
    // Monday is still due via the live grid (the bug dropped it).
    const monday = startOfDay(new Date("2026-06-15T12:00:00"));
    expect(dueSlotsForDay(mwf, overrideDays.get("p-mwf"), monday, proto.startDate, proto.endDate)).toHaveLength(1);
    // The stray off-grid Tuesday is simply ignored (not in the M/W/F grid).
    const tuesday = startOfDay(new Date("2026-06-16T12:00:00"));
    expect(dueSlotsForDay(mwf, overrideDays.get("p-mwf"), tuesday, proto.startDate, proto.endDate)).toHaveLength(0);
  });
});
