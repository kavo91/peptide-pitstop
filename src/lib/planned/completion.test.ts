import { describe, expect, it } from "vitest";
import { autoCompleteProtocolIds, protocolShouldAutoComplete, type CompletionProtocolInput } from "./completion";

const d = (s: string): Date => new Date(`${s}T00:00:00`);

function proto(overrides: Partial<CompletionProtocolInput> = {}): CompletionProtocolInput {
  return {
    id: "p1",
    status: "active",
    scheduleRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    startDate: d("2026-06-01"),
    endDate: d("2026-07-06"),
    deliveredLogs: [],
    ...overrides,
  };
}

describe("protocolShouldAutoComplete", () => {
  it("does not complete protocols without an end date", () => {
    expect(protocolShouldAutoComplete(proto({ endDate: null }), d("2026-07-30"))).toBe(false);
  });

  it("does not complete paused or already-completed protocols", () => {
    expect(protocolShouldAutoComplete(proto({ status: "paused" }), d("2026-07-30"))).toBe(false);
    expect(protocolShouldAutoComplete(proto({ status: "completed" }), d("2026-07-30"))).toBe(false);
  });

  it("completes after the inclusive end date has passed", () => {
    expect(protocolShouldAutoComplete(proto(), d("2026-07-07"))).toBe(true);
  });

  it("keeps an end-date final dose active until it is logged", () => {
    expect(protocolShouldAutoComplete(proto(), d("2026-07-06"))).toBe(false);
  });

  it("completes on the end date once the final scheduled dose has been logged", () => {
    expect(protocolShouldAutoComplete(proto({ deliveredLogs: [{ takenAt: d("2026-07-06") }] }), d("2026-07-06"))).toBe(true);
  });

  it("counts an after-midnight dose on its frozen phone tracking day", () => {
    expect(protocolShouldAutoComplete(proto({
      deliveredLogs: [{
        takenAt: new Date("2026-07-07T15:03:00"),
        localDay: "2026-07-06",
      }],
    }), d("2026-07-06"))).toBe(true);
  });

  it("completes on the end date when no slot falls on that date", () => {
    expect(protocolShouldAutoComplete(proto({ endDate: d("2026-07-05") }), d("2026-07-05"))).toBe(true);
  });

  it("returns just the active protocols due for completion", () => {
    expect(autoCompleteProtocolIds([proto({ id: "done" }), proto({ id: "open", endDate: null })], d("2026-07-07"))).toEqual(["done"]);
  });
});
