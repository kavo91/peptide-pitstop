import { describe, it, expect } from "vitest";
import { doseDayKey } from "./local-day";

// A legacy row (localDay null) buckets by the runtime-local
// day, like every other surface — not the UTC date. vitest pins TZ=Australia/Brisbane.
describe("doseDayKey", () => {
  it("legacy row taken 23:30Z is the NEXT local day in Brisbane", () => {
    expect(doseDayKey({ localDay: null, takenAt: new Date("2024-03-10T23:30:00Z") })).toBe("2024-03-11");
  });
  it("a stamped localDay always wins", () => {
    expect(doseDayKey({ localDay: "2024-03-10", takenAt: new Date("2024-03-10T23:30:00Z") })).toBe("2024-03-10");
  });
});
