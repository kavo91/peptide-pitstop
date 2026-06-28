import { describe, it, expect } from "vitest";
import { computeNextDose } from "./next-dose";
import type { NextDoseProtocol } from "./next-dose";

// Helpers mirror the schedule-test fixture style: JSON schedule rules + Dates.
const proto = (
  over: Partial<NextDoseProtocol> & { id: string; name: string; rule: string },
): NextDoseProtocol => ({
  id: over.id,
  scheduleRule: over.rule,
  startDate: over.startDate ?? null,
  endDate: over.endDate ?? null,
  peptide: { name: over.name },
});

// Daily-with-time and weekly-by-day rules as stored on Protocol.scheduleRule.
const dailyAt = (...times: string[]) =>
  JSON.stringify([{ dayPattern: { kind: "daily" }, times }]);
const weeklyAt = (byDays: string[], times: string[] = []) =>
  JSON.stringify([{ dayPattern: { kind: "weekly", byDays }, times }]);

describe("computeNextDose", () => {
  it("returns null when there are no protocols", () => {
    expect(computeNextDose([], new Date("2026-06-22T09:00:00"))).toBeNull();
  });

  it("returns null when nothing is upcoming within the look-ahead window", () => {
    // Weekly Monday protocol that ended last week → no upcoming slot.
    const p = proto({
      id: "p1",
      name: "BPC-157",
      rule: weeklyAt(["MO"], ["08:00"]),
      startDate: new Date("2026-05-01T00:00:00"),
      endDate: new Date("2026-06-15T00:00:00"), // a Monday; window closed
    });
    // Now is the following Wednesday — past the endDate.
    expect(computeNextDose([p], new Date("2026-06-17T09:00:00"))).toBeNull();
  });

  it("picks the soonest slot across two protocols", () => {
    // BPC daily @ 20:00, Ipamorelin daily @ 09:30. Now = 08:00 → Ipamorelin (09:30) is next.
    const bpc = proto({ id: "p-bpc", name: "BPC-157", rule: dailyAt("20:00") });
    const ipa = proto({ id: "p-ipa", name: "Ipamorelin", rule: dailyAt("09:30") });
    const now = new Date("2026-06-22T08:00:00"); // Monday
    const next = computeNextDose([bpc, ipa], now);
    expect(next?.peptideName).toBe("Ipamorelin");
    expect(next?.protocolId).toBe("p-ipa");
    expect(next?.at.getTime()).toBe(new Date("2026-06-22T09:30:00").getTime());
  });

  it("returns the later-today slot when one is still upcoming today", () => {
    // Daily @ 20:00, now = 14:00 → today's 20:00 is the next dose (not tomorrow's).
    const bpc = proto({ id: "p-bpc", name: "BPC-157", rule: dailyAt("20:00") });
    const now = new Date("2026-06-22T14:00:00");
    const next = computeNextDose([bpc], now);
    expect(next?.at.getTime()).toBe(new Date("2026-06-22T20:00:00").getTime());
  });

  it("rolls to tomorrow once today's only slot has passed", () => {
    // Daily @ 08:00, now = 09:00 → today's 08:00 is past → next is tomorrow 08:00.
    const bpc = proto({ id: "p-bpc", name: "BPC-157", rule: dailyAt("08:00") });
    const now = new Date("2026-06-22T09:00:00");
    const next = computeNextDose([bpc], now);
    expect(next?.at.getTime()).toBe(new Date("2026-06-23T08:00:00").getTime());
  });

  it("excludes an expired protocol and falls through to an active one", () => {
    // Expired daily protocol (endDate yesterday) vs active weekly Thursday protocol.
    const expired = proto({
      id: "p-old",
      name: "Old-Pep",
      rule: dailyAt("08:00"),
      endDate: new Date("2026-06-21T00:00:00"), // Sunday — closed before "now"
    });
    const active = proto({
      id: "p-new",
      name: "CJC-1295",
      rule: weeklyAt(["TH"], ["08:00"]),
    });
    const now = new Date("2026-06-22T09:00:00"); // Monday
    const next = computeNextDose([expired, active], now);
    expect(next?.peptideName).toBe("CJC-1295");
    // Next Thursday 2026-06-25 @ 08:00.
    expect(next?.at.getTime()).toBe(new Date("2026-06-25T08:00:00").getTime());
  });

  it("respects startDate — a not-yet-started protocol is excluded until it begins", () => {
    const future = proto({
      id: "p-fut",
      name: "Future-Pep",
      rule: dailyAt("08:00"),
      startDate: new Date("2026-06-25T00:00:00"), // starts Thursday
    });
    const now = new Date("2026-06-22T09:00:00"); // Monday
    const next = computeNextDose([future], now);
    // First eligible slot is the startDate's 08:00.
    expect(next?.at.getTime()).toBe(new Date("2026-06-25T08:00:00").getTime());
  });

  it("resolves an untimed slot to the start of its day (local midnight)", () => {
    // Untimed daily. Now = 09:00 today → today's midnight is past → tomorrow's midnight.
    const bpc = proto({ id: "p-bpc", name: "BPC-157", rule: dailyAt() });
    const now = new Date("2026-06-22T09:00:00");
    const next = computeNextDose([bpc], now);
    expect(next?.at.getTime()).toBe(new Date("2026-06-23T00:00:00").getTime());
  });

  it("returns null past the look-ahead window (next slot is too far out)", () => {
    // Weekly Monday, but look-ahead clipped to 3 days from a Tuesday → no Monday in range.
    const p = proto({ id: "p1", name: "BPC-157", rule: weeklyAt(["MO"], ["08:00"]) });
    const now = new Date("2026-06-23T09:00:00"); // Tuesday
    expect(computeNextDose([p], now, 3)).toBeNull(); // next Monday is 6 days out
  });

  it("ignores protocols with an empty/malformed schedule rule", () => {
    const empty = proto({ id: "p-empty", name: "No-Sched", rule: "" });
    const bad = proto({ id: "p-bad", name: "Bad-Sched", rule: "[not json" });
    expect(computeNextDose([empty, bad], new Date("2026-06-22T09:00:00"))).toBeNull();
  });
});
