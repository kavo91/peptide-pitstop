import { describe, it, expect } from "vitest";
import { validateScheduleRule } from "./validate";

/** Serialise a single-entry schedule the way ProtocolForm / updateStackSchedule do. */
const rule = (dayPattern: unknown) => JSON.stringify([{ dayPattern, times: [] }]);
const START = "2026-06-15";

describe("validateScheduleRule", () => {
  it("accepts a valid daily rule", () => {
    expect(validateScheduleRule(rule({ kind: "daily" }))).toEqual({ ok: true });
  });

  it("accepts a valid weekly rule with good weekday codes", () => {
    expect(validateScheduleRule(rule({ kind: "weekly", byDays: ["MO", "WE", "FR"] }))).toEqual({ ok: true });
  });

  it("accepts interval/cycle when a startDate is supplied", () => {
    expect(validateScheduleRule(rule({ kind: "interval", everyDays: 3 }), START)).toEqual({ ok: true });
    expect(validateScheduleRule(rule({ kind: "cycle", onDays: 5, offDays: 2 }), START)).toEqual({ ok: true });
  });

  it("rejects an empty / unparseable rule", () => {
    expect(validateScheduleRule("").ok).toBe(false);
    expect(validateScheduleRule("[]").ok).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(validateScheduleRule(rule({ kind: "fortnightly" })).ok).toBe(false);
  });

  it("rejects weekly with no days", () => {
    expect(validateScheduleRule(rule({ kind: "weekly", byDays: [] })).ok).toBe(false);
  });

  it("rejects weekly with an invalid weekday code", () => {
    expect(validateScheduleRule(rule({ kind: "weekly", byDays: ["MO", "XX"] })).ok).toBe(false);
  });

  it("rejects interval with everyDays < 1", () => {
    expect(validateScheduleRule(rule({ kind: "interval", everyDays: 0 }), START).ok).toBe(false);
  });

  it("rejects cycle with onDays < 1", () => {
    expect(validateScheduleRule(rule({ kind: "cycle", onDays: 0, offDays: 2 }), START).ok).toBe(false);
  });

  it("rejects cycle with offDays < 1", () => {
    expect(validateScheduleRule(rule({ kind: "cycle", onDays: 5, offDays: 0 }), START).ok).toBe(false);
  });

  it("rejects an interval rule with no valid startDate (never due)", () => {
    expect(validateScheduleRule(rule({ kind: "interval", everyDays: 3 })).ok).toBe(false);
    expect(validateScheduleRule(rule({ kind: "interval", everyDays: 3 }), "").ok).toBe(false);
  });

  it("rejects a cycle rule with no valid startDate (never due)", () => {
    expect(validateScheduleRule(rule({ kind: "cycle", onDays: 5, offDays: 2 })).ok).toBe(false);
    expect(validateScheduleRule(rule({ kind: "cycle", onDays: 5, offDays: 2 }), "not-a-date").ok).toBe(false);
  });
});
