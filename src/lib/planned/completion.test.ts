import { describe, it, expect } from "vitest";
import { autoCompleteProtocolIds, protocolShouldAutoComplete } from "./completion";

const d = (s: string) => new Date(s + "T00:00:00");
const proto = (overrides: Partial<Parameters<typeof protocolShouldAutoComplete>[0]> = {}) => ({
  id: "p1",
  status: "active",
  scheduleRule: "FREQ=WEEKLY;BYDAY=MO",
  startDate: d("2026-06-01"),
  endDate: d("2026-07-06"),
  deliveredLogs: [],
  ...overrides,
});

describe("protocol auto-completion", () => {
  it("keeps an active protocol active on its inclusive endDate while the final slot remains unlogged", () => {
    expect(protocolShouldAutoComplete(proto(), d("2026-07-06"))).toBe(false);
  });

  it("completes on the endDate once the final scheduled dose has been logged", () => {
    expect(protocolShouldAutoComplete(proto({
      deliveredLogs: [{ takenAt: d("2026-07-06") }],
    }), d("2026-07-06"))).toBe(true);
  });

  it("completes an active protocol on the first day after endDate", () => {
    expect(protocolShouldAutoComplete(proto(), d("2026-07-07"))).toBe(true);
  });

  it("completes a protocol with no schedule rule when the endDate is reached", () => {
    expect(protocolShouldAutoComplete(proto({ scheduleRule: null }), d("2026-07-06"))).toBe(true);
  });

  it("returns the ids of protocols that should auto-complete", () => {
    expect(autoCompleteProtocolIds([
      proto({ id: "keep", endDate: d("2026-07-13") }),
      proto({ id: "done", deliveredLogs: [{ takenAt: d("2026-07-06") }] }),
      proto({ id: "paused", status: "paused", deliveredLogs: [{ takenAt: d("2026-07-06") }] }),
    ], d("2026-07-07"))).toEqual(["done"]);
  });
});
