import { describe, it, expect } from "vitest";
import { scheduleToken, scheduleTokenInfo } from "./token";

/** Build a JSON scheduleRule from raw entries (mirrors Protocol.scheduleRule storage). */
const rule = (entries: unknown[]) => JSON.stringify(entries);

describe("scheduleToken — well-formed single-entry rules (byte-identical to prior inline impl)", () => {
  it("daily JSON → DAILY (isDaily)", () => {
    const r = rule([{ dayPattern: { kind: "daily" }, times: [] }]);
    expect(scheduleToken(r)).toBe("DAILY");
    expect(scheduleTokenInfo(r)).toEqual({ token: "DAILY", isDaily: true });
  });

  it("legacy FREQ=DAILY → DAILY", () => {
    expect(scheduleToken("FREQ=DAILY")).toBe("DAILY");
    expect(scheduleTokenInfo("FREQ=DAILY").isDaily).toBe(true);
  });

  it("weekly → weekday codes joined with · in DAY_ORDER (Mon-first)", () => {
    const r = rule([{ dayPattern: { kind: "weekly", byDays: ["FR", "MO", "WE"] }, times: [] }]);
    expect(scheduleToken(r)).toBe("MO·WE·FR");
    expect(scheduleTokenInfo(r).isDaily).toBe(false);
  });

  it("legacy weekly RRULE → weekday codes", () => {
    expect(scheduleToken("FREQ=WEEKLY;BYDAY=MO,WE,FR")).toBe("MO·WE·FR");
  });

  it("interval everyDays>1 → EVERY ND", () => {
    const r = rule([{ dayPattern: { kind: "interval", everyDays: 3 }, times: [] }]);
    expect(scheduleToken(r)).toBe("EVERY 3D");
    expect(scheduleTokenInfo(r).isDaily).toBe(false);
  });

  it("interval everyDays=1 → DAILY (isDaily)", () => {
    const r = rule([{ dayPattern: { kind: "interval", everyDays: 1 }, times: [] }]);
    expect(scheduleToken(r)).toBe("DAILY");
    expect(scheduleTokenInfo(r)).toEqual({ token: "DAILY", isDaily: true });
  });

  it("cycle → on/off", () => {
    const r = rule([{ dayPattern: { kind: "cycle", onDays: 5, offDays: 2 }, times: [] }]);
    expect(scheduleToken(r)).toBe("5/2");
    expect(scheduleTokenInfo(r).isDaily).toBe(false);
  });
});

describe("scheduleToken — defensive: empty / malformed / garbage → —", () => {
  it("null rule", () => {
    expect(scheduleToken(null)).toBe("—");
    expect(scheduleTokenInfo(null)).toEqual({ token: "—", isDaily: false });
  });
  it("undefined rule", () => {
    expect(scheduleToken(undefined)).toBe("—");
  });
  it("empty string", () => {
    expect(scheduleToken("")).toBe("—");
  });
  it("whitespace only", () => {
    expect(scheduleToken("   ")).toBe("—");
  });
  it("empty JSON array (no entries)", () => {
    expect(scheduleToken("[]")).toBe("—");
  });
  it("unparseable JSON", () => {
    expect(scheduleToken("[{ broken")).toBe("—");
  });
  it("non-array JSON", () => {
    expect(scheduleToken('{"dayPattern":{"kind":"daily"}}')).toBe("—");
  });
  it("weekly with empty byDays", () => {
    expect(scheduleToken(rule([{ dayPattern: { kind: "weekly", byDays: [] }, times: [] }]))).toBe("—");
  });
  it("weekly with an invalid day code → only valid codes rendered (invalid dropped)", () => {
    const r = rule([{ dayPattern: { kind: "weekly", byDays: ["MO", "XX", "WE"] }, times: [] }]);
    expect(scheduleToken(r)).toBe("MO·WE");
  });
  it("weekly with only invalid day codes → —", () => {
    const r = rule([{ dayPattern: { kind: "weekly", byDays: ["XX", "ZZ"] }, times: [] }]);
    expect(scheduleToken(r)).toBe("—");
  });
  it("interval everyDays < 1", () => {
    expect(scheduleToken(rule([{ dayPattern: { kind: "interval", everyDays: 0 }, times: [] }]))).toBe("—");
  });
  it("cycle onDays < 1", () => {
    expect(scheduleToken(rule([{ dayPattern: { kind: "cycle", onDays: 0, offDays: 2 }, times: [] }]))).toBe("—");
  });
  it("cycle offDays < 1", () => {
    expect(scheduleToken(rule([{ dayPattern: { kind: "cycle", onDays: 5, offDays: 0 }, times: [] }]))).toBe("—");
  });
  it("entry missing dayPattern → dropped by parseSchedule → —", () => {
    expect(scheduleToken(rule([{ times: [] }]))).toBe("—");
  });
});

describe("scheduleToken — multi-entry rules append +N (no silent truncation)", () => {
  it("two entries → first token + +1", () => {
    const r = rule([
      { dayPattern: { kind: "daily" }, times: ["08:00"] },
      { dayPattern: { kind: "weekly", byDays: ["MO"] }, times: ["20:00"] },
    ]);
    expect(scheduleToken(r)).toBe("DAILY +1");
    // isDaily reflects the FIRST entry's cadence.
    expect(scheduleTokenInfo(r)).toEqual({ token: "DAILY +1", isDaily: true });
  });

  it("three entries → first token + +2", () => {
    const r = rule([
      { dayPattern: { kind: "weekly", byDays: ["MO", "TH"] }, times: ["08:00"] },
      { dayPattern: { kind: "interval", everyDays: 3 }, times: [] },
      { dayPattern: { kind: "cycle", onDays: 5, offDays: 2 }, times: [] },
    ]);
    expect(scheduleToken(r)).toBe("MO·TH +2");
    expect(scheduleTokenInfo(r).isDaily).toBe(false);
  });

  it("multi-entry with malformed FIRST entry → — (first-entry-driven)", () => {
    const r = rule([
      { dayPattern: { kind: "weekly", byDays: [] }, times: [] },
      { dayPattern: { kind: "daily" }, times: [] },
    ]);
    expect(scheduleToken(r)).toBe("—");
  });
});
