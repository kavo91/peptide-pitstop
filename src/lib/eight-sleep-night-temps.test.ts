import { describe, it, expect } from "vitest";
import { nightTemps, meanTemp, pickNight } from "./eight-sleep-night-temps";

const T = (h: number) => `2027-10-26T${String(h).padStart(2, "0")}:00:00.000Z`;
const ms = (h: number) => Date.parse(T(h));

describe("nightTemps", () => {
  it("reads bed and room readings from the session timeseries", () => {
    const n = nightTemps({
      sessions: [{ timeseries: { tempBedC: [[T(12), 28], [T(13), 29.5]], tempRoomC: [[T(12), 21]] } }],
    });
    expect(n).toEqual({
      bed: [{ t: ms(12), v: 28 }, { t: ms(13), v: 29.5 }],
      room: [{ t: ms(12), v: 21 }],
    });
  });

  it("joins all sessions of the night in time order", () => {
    const n = nightTemps({
      sessions: [
        { timeseries: { tempBedC: [[T(16), 30]] } },
        { timeseries: { tempBedC: [[T(12), 28], [T(14), 29]] } },
      ],
    });
    expect(n!.bed.map((p) => p.t)).toEqual([ms(12), ms(14), ms(16)]);
  });

  it("drops \"None\", zero, negative and non-numeric values", () => {
    const n = nightTemps({
      sessions: [{ timeseries: { tempBedC: [[T(12), "None"], [T(13), 0], [T(14), -1], [T(15), "x"], [T(16), "27.4"]] } }],
    });
    expect(n!.bed).toEqual([{ t: ms(16), v: 27.4 }]);
    expect(n!.room).toEqual([]);
  });

  it("reads a zone-less time as UTC, not local", () => {
    const n = nightTemps({ sessions: [{ timeseries: { tempRoomC: [["2027-10-26T12:00:00", 21]] } }] });
    expect(n!.room[0].t).toBe(ms(12));
  });

  it("skips malformed points", () => {
    const n = nightTemps({ sessions: [{ timeseries: { tempBedC: [null, [5, 28], ["garbage", 28], [T(12), 28]] } }] });
    expect(n!.bed).toEqual([{ t: ms(12), v: 28 }]);
  });

  it("is null when the night has no temperature readings", () => {
    expect(nightTemps(null)).toBeNull();
    expect(nightTemps({})).toBeNull();
    expect(nightTemps({ sessions: [{}] })).toBeNull();
    expect(nightTemps({ sessions: [{ timeseries: { heartRate: [[T(12), 55]], tempBedC: [] } }] })).toBeNull();
  });
});

describe("meanTemp", () => {
  it("averages the readings, null when empty", () => {
    expect(meanTemp([{ t: 1, v: 28 }, { t: 2, v: 30 }])).toBe(29);
    expect(meanTemp([])).toBeNull();
  });
});

describe("pickNight", () => {
  const nights = ["2027-10-25", "2027-10-26", "2027-10-27"];
  it("defaults to the newest night", () => {
    expect(pickNight(nights, undefined)).toEqual({ night: "2027-10-27", prev: "2027-10-26", next: null });
  });
  it("uses a stored night when asked, with both neighbours", () => {
    expect(pickNight(nights, "2027-10-26")).toEqual({ night: "2027-10-26", prev: "2027-10-25", next: "2027-10-27" });
    expect(pickNight(nights, "2027-10-25")).toEqual({ night: "2027-10-25", prev: null, next: "2027-10-26" });
  });
  it("ignores an unknown, malformed or repeated ?night=", () => {
    for (const asked of ["2027-09-30", "garbage", ["2027-10-25"], 5]) {
      expect(pickNight(nights, asked)?.night).toBe("2027-10-27");
    }
  });
  it("is null with no nights", () => {
    expect(pickNight([], "2027-10-27")).toBeNull();
  });
});
