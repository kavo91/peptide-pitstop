import { describe, it, expect } from "vitest";
import { addDays, dateOnlyCeil, dateOnlyFloor } from "./schedule/schedule";
import { planEndCycle, planNextCycle } from "./cycle/actions-plan";
import { cycleAnchorFollow } from "./cycle/anchor";
import { homeStartBound, startsOnOrBefore, hasStartedBy } from "./protocol-day-bounds";
import { buildForecastPlan, type ProtocolForForecast } from "./forecast-slots";
import { supersededFrom } from "./doses-timeline-core";

/**
 * v1.25.9 date-only follow-ups, in any server time zone (`npm run test:tz`
 * runs this file under America/New_York and America/Santiago; the main suite
 * runs it under Australia/Brisbane).
 *
 * A protocol date can be stored in two forms: 00:00 UTC of the day (what the
 * date inputs write, and since v1.25.9 the cycle actions too) and a
 * server-local midnight (what startNextCycle / endCycle wrote before). Every
 * reader here must put both forms on the same calendar day.
 */

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const D = (key: string) => new Date(`${key}T00:00:00.000Z`);
const L = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const at = (key: string, h: number, min = 0) => {
  const d = L(key);
  d.setHours(h, min, 0, 0);
  return d;
};
const K = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const both = (key: string) => [D(key), L(key)];

/** Prisma range semantics, applied in memory. */
type Bound = { lt?: Date; lte?: Date; gt?: Date; gte?: Date };
const passes = (b: Bound, v: Date) =>
  (b.lt === undefined || v < b.lt) &&
  (b.lte === undefined || v <= b.lte) &&
  (b.gt === undefined || v > b.gt) &&
  (b.gte === undefined || v >= b.gte);

// Calendar days across a year, plus both 2027 DST switches of both matrix zones
// (New York 03-14 / 11-07, Santiago 04-04 / 09-05; midnight does not exist
// on 09-05) and the days around them.
const DAYS: string[] = [];
for (let i = 0; i < 400; i += 3) DAYS.push(K(addDays(L("2026-12-31"), i)));
for (const k of ["2027-03-14", "2027-04-04", "2027-09-05", "2027-11-07"]) {
  for (const d of [-1, 0, 1]) DAYS.push(K(addDays(L(k), d)));
}

describe(`date-only follow-ups under ${zone}`, () => {
  it("dateOnlyFloor / dateOnlyCeil bracket exactly the day, for both stored forms", () => {
    for (const k of DAYS) {
      const day = L(k);
      const prev = K(addDays(day, -1));
      const next = K(addDays(day, 1));
      const floor = { gte: dateOnlyFloor(day) };
      const ceil = { lt: dateOnlyCeil(day) };
      for (const v of both(k)) {
        expect(passes(floor, v), `${k} floor ${v.toISOString()}`).toBe(true);
        expect(passes(ceil, v), `${k} ceil ${v.toISOString()}`).toBe(true);
      }
      for (const v of both(prev)) expect(passes(floor, v), `${k} floor prev ${v.toISOString()}`).toBe(false);
      for (const v of both(next)) expect(passes(ceil, v), `${k} ceil next ${v.toISOString()}`).toBe(false);
    }
  });

  it("startNextCycle writes 00:00Z of the server's day, whatever the hour", () => {
    for (const k of ["2027-03-14", "2027-04-04", "2027-09-05", "2027-10-02", "2027-11-07"]) {
      for (const h of [0, 8, 23]) {
        const next = planNextCycle({ startDate: null, cycleOnWeeks: 4 }, at(k, h, 30));
        expect(next.data.cycleAnchor.toISOString()).toBe(`${k}T00:00:00.000Z`);
        expect(next.data.startDate?.toISOString()).toBe(`${k}T00:00:00.000Z`);
        expect(next.data.endDate?.toISOString()).toBe(`${K(addDays(L(k), 27))}T00:00:00.000Z`);
        expect(next.audit).toBe(`next cycle started ${k}`);
      }
    }
  });

  it("endCycle writes 00:00Z of the planned last day, from either anchor form", () => {
    for (const anchor of both("2027-09-13")) {
      const r = planEndCycle({ startDate: D("2027-08-31"), endDate: null, cycleAnchor: anchor, cycleOnWeeks: 4 });
      expect(r.endDate?.toISOString()).toBe("2027-10-10T00:00:00.000Z");
      expect(r.audit).toBe("cycle ended (endDate 2027-10-10)");
    }
  });

  it("endCycle keeps an end date on or before the planned day, in either form, as stored", () => {
    for (const end of [...both("2027-10-10"), ...both("2027-10-04")]) {
      const r = planEndCycle({ startDate: D("2027-09-13"), endDate: end, cycleAnchor: null, cycleOnWeeks: 4 });
      expect(r.endDate).toBe(end);
    }
    for (const end of both("2027-10-11")) {
      const r = planEndCycle({ startDate: D("2027-09-13"), endDate: end, cycleAnchor: null, cycleOnWeeks: 4 });
      expect(r.endDate?.toISOString()).toBe("2027-10-10T00:00:00.000Z");
    }
  });

  it("home tiles count a protocol from the first minute of its start day to the last minute", () => {
    for (const k of ["2027-03-14", "2027-04-04", "2027-10-02", "2027-11-07"]) {
      const next = K(addDays(L(k), 1));
      for (const [h, min] of [[0, 1], [9, 59], [23, 59]] as const) {
        const b = homeStartBound(at(k, h, min));
        for (const v of both(k)) expect(passes(b, v), `${k} ${h}:${min} ${v.toISOString()}`).toBe(true);
        for (const v of both(next)) expect(passes(b, v), `${k} ${h}:${min} next ${v.toISOString()}`).toBe(false);
      }
    }
  });

  it("a range bound includes a protocol starting on the range's last day", () => {
    for (const k of DAYS) {
      const b = startsOnOrBefore(L(k));
      for (const v of both(k)) expect(passes(b, v), `${k} ${v.toISOString()}`).toBe(true);
      for (const v of both(K(addDays(L(k), 1)))) expect(passes(b, v), `${k} next ${v.toISOString()}`).toBe(false);
    }
  });

  it("analytics counts a protocol as started for its whole start day", () => {
    for (const v of both("2027-10-02")) {
      expect(hasStartedBy(v, at("2027-10-02", 0, 1))).toBe(true);
      expect(hasStartedBy(v, at("2027-10-02", 23, 59))).toBe(true);
      expect(hasStartedBy(v, at("2027-10-01", 23, 59))).toBe(false);
    }
    expect(hasStartedBy(null, at("2027-10-02", 8))).toBe(true);
  });

  it("the forecast reads an end date in either form as that day", () => {
    for (const end of both("2027-10-10")) {
      const protocol: ProtocolForForecast = {
        doseBasis: "per_injection",
        targetDose: "100",
        doseInputUnit: "mcg",
        scheduleRule: JSON.stringify([{ dayPattern: { kind: "daily" }, times: ["09:00"] }]),
        rebaseMode: "fixed_anchor",
        startDate: D("2027-09-13"),
        endDate: end,
        adherenceWindowMin: 120,
        steps: [],
        cycleAnchor: null,
        cycleOnWeeks: null,
        cycleOffWeeks: null,
      };
      const fc = buildForecastPlan({ protocol, deliveredLogs: [], now: at("2027-10-02", 12) });
      expect(fc.courseEndDate && K(fc.courseEndDate)).toBe("2027-10-10");
      expect(K(fc.slots[fc.slots.length - 1].date)).toBe("2027-10-10");
    }
  });

  it("a retired course hands over on its successor's start day, in either form", () => {
    for (const start of both("2027-10-04")) {
      const out = supersededFrom([
        { id: "old", peptideId: "p", courseId: "c", status: "completed", startDate: D("2027-08-31") },
        { id: "new", peptideId: "p", courseId: "c", status: "active", startDate: start },
      ]);
      expect(out.get("old")).toBe("2027-10-04");
    }
  });

  it("the cycle anchor follows a moved start date when the two are stored in different forms", () => {
    // Linked: stored anchor and stored start on the same day, different forms.
    const moved = cycleAnchorFollow({
      storedStartDate: L("2027-09-13"),
      storedAnchor: D("2027-09-13"),
      nextStartDate: D("2027-09-20"),
      hasDoseLogs: false,
    });
    expect(moved.move).toBe(true);
    // Not moved: the new start is the same day as the stored one.
    const echo = cycleAnchorFollow({
      storedStartDate: L("2027-09-30"),
      storedAnchor: L("2027-09-30"),
      nextStartDate: D("2027-09-30"),
      hasDoseLogs: false,
    });
    expect(echo.move).toBe(false);
  });
});
