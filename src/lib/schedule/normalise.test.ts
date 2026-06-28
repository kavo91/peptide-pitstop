import { describe, it, expect } from "vitest";
import { normaliseScheduleRule } from "./normalise";

const rule = (pattern: unknown, times: string[] = []) =>
  JSON.stringify([{ dayPattern: pattern, times }]);

const START = "2026-01-01";

describe("normaliseScheduleRule — valid rules", () => {
  it("passes a daily rule (no start date needed)", () => {
    const res = normaliseScheduleRule(rule({ kind: "daily" }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(JSON.parse(res.rule)[0].dayPattern.kind).toBe("daily");
  });

  it("passes a weekly rule", () => {
    const res = normaliseScheduleRule(rule({ kind: "weekly", byDays: ["MO", "TH"] }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(JSON.parse(res.rule)[0].dayPattern.byDays).toEqual(["MO", "TH"]);
  });

  it("passes an interval rule with a start date", () => {
    const res = normaliseScheduleRule(rule({ kind: "interval", everyDays: 3 }), START);
    expect(res.ok).toBe(true);
  });

  it("passes a cycle rule with a start date", () => {
    const res = normaliseScheduleRule(rule({ kind: "cycle", onDays: 5, offDays: 2 }), START);
    expect(res.ok).toBe(true);
  });

  it("returns the canonical JSON form of parseSchedule", () => {
    const input = rule({ kind: "daily" }, ["08:00"]);
    const res = normaliseScheduleRule(input);
    expect(res.ok).toBe(true);
    // Canonical form round-trips through parseSchedule.
    if (res.ok) {
      const parsed = JSON.parse(res.rule);
      expect(parsed).toEqual([{ dayPattern: { kind: "daily" }, times: ["08:00"] }]);
    }
  });
});

describe("normaliseScheduleRule — invalid rules", () => {
  it("fails an invalid weekday code", () => {
    const res = normaliseScheduleRule(rule({ kind: "weekly", byDays: ["XX"] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/weekday/i);
  });

  it("fails an empty weekly rule", () => {
    const res = normaliseScheduleRule(rule({ kind: "weekly", byDays: [] }));
    expect(res.ok).toBe(false);
  });

  it("fails an interval rule with no start date", () => {
    const res = normaliseScheduleRule(rule({ kind: "interval", everyDays: 3 }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/start date/i);
  });

  it("fails a cycle rule with no start date", () => {
    const res = normaliseScheduleRule(rule({ kind: "cycle", onDays: 5, offDays: 2 }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/start date/i);
  });

  it("fails a malformed (unparseable) rule", () => {
    expect(normaliseScheduleRule("[{ broken json").ok).toBe(false);
  });

  it("fails an empty rule string", () => {
    expect(normaliseScheduleRule("").ok).toBe(false);
  });
});
