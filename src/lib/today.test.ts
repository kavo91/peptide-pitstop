import { describe, it, expect, afterEach } from "vitest";
import Decimal from "decimal.js";
import { resolveTitration } from "./titration/resolve";
import { buildResolveInput } from "./titration/from-protocol";
import { perInjectionDose } from "./titration/dose-basis";
import { startOfDay } from "./schedule/schedule";
import { classifyOverrideDays, dueSlotsForDay, dayKey } from "./today-overrides";
import { buildTodayProtocolWhere, shouldShowCompletedLoggedFallback } from "./today";

// getTodayDoses is DB-bound; these guard the exact resolver contract it relies
// on. today.ts builds its ResolveInput via buildResolveInput, then reads the
// slot matching the day/slot.time to set doseValue/doseUnit + alreadyLoggedToday.
const d = (s: string) => new Date(s + "T00:00:00");
const wk = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "TH"] }, times: [] }]);

describe("today protocol selection", () => {
  it("keeps completed protocols with a same-day log in the schedule candidate set", () => {
    const day = d("2026-07-05");
    const nextDay = d("2026-07-06");

    expect(buildTodayProtocolWhere("user-1", day, nextDay)).toEqual({
      userId: "user-1",
      OR: [
        { status: "active" },
        {
          status: "completed",
          doseLogs: {
            some: {
              userId: "user-1",
              // v1.4.1: localDay-first day bucketing with the legacy
              // instant-window fallback (same shape as getLoggedToday).
              OR: [{ localDay: "2026-07-05" }, { localDay: null, takenAt: { gte: day, lt: nextDay } }],
            },
          },
        },
      ],
    });
  });

  it("synthesizes a logged schedule row only for completed protocols with a same-day log and no normal slot", () => {
    expect(shouldShowCompletedLoggedFallback("completed", 0, 1)).toBe(true);
    expect(shouldShowCompletedLoggedFallback("completed", 1, 1)).toBe(false);
    expect(shouldShowCompletedLoggedFallback("completed", 0, 0)).toBe(false);
    expect(shouldShowCompletedLoggedFallback("active", 0, 1)).toBe(false);
    expect(shouldShowCompletedLoggedFallback("paused", 0, 1)).toBe(false);
  });
});

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

  // BPC+TB4 prod bug (2026-07-02): moving a stack's start date FORWARD leaves
  // already-materialised "planned" rows behind (daily rows for Jul 2–5 written
  // while the stack started immediately). Those rows now sit outside the
  // window-gated grid, so the classifier misread them as fixed_anchor rebase
  // overrides — and the override branch of dueSlotsForDay bypasses the
  // start-date gate entirely, so Today kept showing the doses as due days
  // before the protocol had started.
  it("stale PRE-START planned rows are ignored — not overrides, nothing due before the start date", () => {
    process.env.TZ = "Australia/Brisbane";
    const daily = JSON.stringify([{ dayPattern: { kind: "daily" }, times: [] }]);
    const stack = {
      id: "p-stack",
      scheduleRule: daily,
      rebaseMode: "fixed_anchor" as const,
      // Exactly the prod shape: start date Mon 2026-07-06 stored as a
      // UTC-midnight instant (= 10:00 Brisbane).
      startDate: new Date("2026-07-06T00:00:00Z"),
      endDate: null,
    };
    // Stale rows Thu 2026-07-02 … Sun 2026-07-05, Brisbane local midnights.
    const staleRows = ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"].map((utcDay) => ({
      protocolId: "p-stack",
      scheduledAt: new Date(`${utcDay}T14:00:00Z`),
    }));

    const overrideDays = classifyOverrideDays([stack], staleRows);
    expect(overrideDays.get("p-stack")).toBeUndefined();

    // The symptom: Today (Thu 2026-07-02) must show NO due slot.
    const today = startOfDay(new Date("2026-07-02T12:00:00"));
    expect(dueSlotsForDay(daily, overrideDays.get("p-stack"), today, stack.startDate, stack.endDate)).toHaveLength(0);

    // From the start date onward the live grid takes over as normal.
    const startDay = startOfDay(new Date("2026-07-06T12:00:00"));
    expect(dueSlotsForDay(daily, overrideDays.get("p-stack"), startDay, stack.startDate, stack.endDate)).toHaveLength(1);
  });

  it("stale POST-END planned rows are equally ignored", () => {
    process.env.TZ = "Australia/Brisbane";
    const daily = JSON.stringify([{ dayPattern: { kind: "daily" }, times: [] }]);
    const ended = {
      id: "p-ended",
      scheduleRule: daily,
      rebaseMode: "fixed_anchor" as const,
      startDate: new Date("2026-06-01T00:00:00Z"),
      endDate: new Date("2026-06-30T00:00:00Z"),
    };
    // A leftover row on Thu 2026-07-02 local — after the protocol ended.
    const overrideDays = classifyOverrideDays([ended], [
      { protocolId: "p-ended", scheduledAt: new Date("2026-07-01T14:00:00Z") },
    ]);
    expect(overrideDays.get("p-ended")).toBeUndefined();
    const day = startOfDay(new Date("2026-07-02T12:00:00"));
    expect(dueSlotsForDay(daily, overrideDays.get("p-ended"), day, ended.startDate, ended.endDate)).toHaveLength(0);
  });

  it("stale POST-END planned rows are equally ignored", () => {
    process.env.TZ = "Australia/Brisbane";
    const moTh = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "TH"] }, times: [] }]);
    const ending = {
      id: "p-final",
      scheduleRule: moTh,
      rebaseMode: "fixed_anchor" as const,
      startDate: new Date("2026-06-01T00:00:00Z"),
      endDate: new Date("2026-07-02T00:00:00Z"), // ends Thu
    };
    // The final Thu dose was rebase-shifted to Fri 2026-07-03 (past the end).
    const fri = startOfDay(new Date("2026-07-03T12:00:00"));
    const overrideDays = classifyOverrideDays([ending], [
      { protocolId: "p-final", scheduledAt: new Date("2026-07-02T14:00:00Z") }, // Fri 3rd local
    ]);
    expect(overrideDays.get("p-final")).toBeUndefined();
    expect(dueSlotsForDay(moTh, overrideDays.get("p-final"), fri, ending.startDate, ending.endDate)).toHaveLength(0);
  });

  it("a genuine IN-window off-grid rebase week still classifies as an override", () => {
    process.env.TZ = "Australia/Brisbane";
    const moTh = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "TH"] }, times: [] }]);
    const started = {
      id: "p-live",
      scheduleRule: moTh,
      rebaseMode: "fixed_anchor" as const,
      startDate: new Date("2026-06-01T00:00:00Z"),
      endDate: null,
    };
    // Week of Mon 2026-06-15 rebased onto Tue/Fri — purely off-grid rows.
    const overrideDays = classifyOverrideDays([started], [
      { protocolId: "p-live", scheduledAt: new Date("2026-06-15T14:00:00Z") }, // Tue 16th local
      { protocolId: "p-live", scheduledAt: new Date("2026-06-18T14:00:00Z") }, // Fri 19th local
    ]);
    const tue = startOfDay(new Date("2026-06-16T12:00:00"));
    expect(overrideDays.get("p-live")?.has(dayKey(tue))).toBe(true);
    expect(dueSlotsForDay(moTh, overrideDays.get("p-live"), tue, started.startDate, started.endDate)).toHaveLength(1);
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

// Tesamorelin prod bug (2026-07-13): an off-grid SUNDAY dose on a weekly M–F
// fixed_anchor protocol rebases the DISPLAY week to Sun–Thu, so
// resolveTitration returns the WHOLE rebased week — many slots, ALL at "21:00",
// on different calendar days. today.ts asked for a single day (Monday) but
// indexed those slots by time alone, so Monday's 21:00 due-slot picked up the
// TAKEN Sunday 21:00 slot → Monday's card read "logged". The fix restricts the
// index to slots whose local calendar day IS today. These guards pin that
// contract against the real resolver (getTodayDoses itself is DB-bound).
describe("shifted week must not mark a later day 'logged' (tesamorelin prod bug)", () => {
  const tesaRule = JSON.stringify([
    { dayPattern: { kind: "weekly", byDays: ["MO", "TU", "WE", "TH", "FR"] }, times: ["21:00"] },
  ]);
  const tesaProto = {
    doseBasis: "per_injection" as const,
    targetDose: new Decimal("0.2"),
    doseInputUnit: "ml",
    scheduleRule: tesaRule,
    rebaseMode: "fixed_anchor" as const,
    startDate: new Date("2026-07-07T00:00:00.000Z"),
    endDate: new Date("2026-09-28T00:00:00.000Z"),
    adherenceWindowMin: 120,
    steps: [] as [],
  };
  // Real logs: Thu Jul 9, Fri Jul 10, and the off-grid Sun Jul 12 22:34 local.
  const tesaLogs = [
    { id: "log-thu", takenAt: new Date("2026-07-09T11:40:00.000Z") },
    { id: "log-fri", takenAt: new Date("2026-07-10T13:15:00.000Z") },
    { id: "log-sun", takenAt: new Date("2026-07-12T12:34:50.449Z") },
  ];

  function resolveMonday() {
    process.env.TZ = "Australia/Brisbane";
    const day = startOfDay(new Date("2026-07-13T00:00:00+10:00")); // Mon Jul 13 local midnight
    const resolved = resolveTitration(
      buildResolveInput({ protocol: tesaProto, deliveredLogs: tesaLogs, range: { start: day, end: day }, now: day }),
    );
    return { day, resolved };
  }

  it("resolveTitration clips a single-day range to that day even when the week is rebased", () => {
    // The rebase rebuilds the WHOLE Sun–Thu week internally (for status + cursor
    // correctness), but the resolver now CLIPS the result to the queried range:
    // only Monday is returned. The taken Sunday slot and the Tue–Thu projections
    // are outside [range.start, range.end] and must not leak out.
    const { resolved } = resolveMonday();
    expect(resolved.slots.length).toBeGreaterThan(0);
    expect(resolved.slots.every((s) => dayKey(s.date) === "2026-07-13")).toBe(true);
    expect(resolved.slots.some((s) => s.status === "taken")).toBe(false); // no Sunday slot leaked in
  });

  it("Monday resolves as an unlogged, shifted dose — not 'logged' (resolver-level fix)", () => {
    // Even indexing by TIME ALONE (the old getTodayDoses pattern) is now safe,
    // because the resolver only returns today's slot.
    const { resolved } = resolveMonday();
    const byTime = new Map<string | null, (typeof resolved.slots)[number]>();
    for (const rs of resolved.slots) if (!byTime.has(rs.time ?? null)) byTime.set(rs.time ?? null, rs);
    const monday = byTime.get("21:00");
    expect(monday).toBeDefined();
    expect(monday?.status).not.toBe("taken");   // Monday is NOT logged
    expect(monday?.rebased).toBe(true);         // it IS shown as shifted (Sun–Thu week)
    const alreadyLoggedToday = monday?.status === "taken";
    expect(alreadyLoggedToday).toBe(false);     // the exact today.ts flag
  });

  it("today.ts's per-day filter is a redundant belt-and-braces guard after the clip", () => {
    // today.ts still filters resolved.slots to dayKey(day); with the resolver
    // clip this is a no-op, but it keeps Today correct even if the clip regresses.
    const { day, resolved } = resolveMonday();
    const daySlots = resolved.slots.filter((rs) => dayKey(rs.date) === dayKey(day));
    expect(daySlots).toEqual(resolved.slots);
    expect(daySlots.find((s) => s.time === "21:00")?.status).not.toBe("taken");
  });
});
