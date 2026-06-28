import { describe, it, expect } from "vitest";
import { Activity, Bike, Dumbbell, Footprints, Waves } from "lucide-react";
import {
  normaliseActivity,
  activityDisplay,
  parseActivitiesJson,
  fmtActivityDuration,
  fmtActivityDistance,
  ACTIVITY_DISPLAY,
  type GarminActivity,
} from "./garmin-activity";

describe("normaliseActivity", () => {
  it("maps a running activity (typeKey → friendly type, seconds, metres)", () => {
    const a = normaliseActivity({
      activityType: { typeKey: "running" },
      duration: 1830.5,
      distance: 5021.3,
      activityName: "Morning Run",
      startTimeLocal: "2026-06-20 06:31:00",
    });
    expect(a.type).toBe("running");
    expect(a.durationSec).toBe(1831); // rounded
    expect(a.distanceM).toBeCloseTo(5021.3, 1);
    expect(a.name).toBe("Morning Run");
    expect(a.startLocal).toBe("2026-06-20 06:31:00");
  });

  it("maps strength_training and cycling and swimming typeKeys", () => {
    expect(normaliseActivity({ activityType: { typeKey: "strength_training" }, duration: 600 }).type).toBe(
      "strength_training",
    );
    expect(normaliseActivity({ activityType: { typeKey: "cycling" }, duration: 3600 }).type).toBe("cycling");
    expect(normaliseActivity({ activityType: { typeKey: "lap_swimming" }, duration: 1800 }).type).toBe(
      "lap_swimming",
    );
  });

  it("tolerates a missing distance (distanceM omitted/undefined)", () => {
    const a = normaliseActivity({ activityType: { typeKey: "strength_training" }, duration: 2700 });
    expect(a.type).toBe("strength_training");
    expect(a.durationSec).toBe(2700);
    expect(a.distanceM).toBeUndefined();
  });

  it("returns a stable shape on garbage input (no throw)", () => {
    const a = normaliseActivity({} as never);
    expect(typeof a.type).toBe("string");
    expect(a.type).toBe("other");
    expect(a.durationSec).toBe(0);
    expect(a.distanceM).toBeUndefined();
  });

  it("treats non-finite duration/distance as missing", () => {
    const a = normaliseActivity({
      activityType: { typeKey: "running" },
      duration: "not-a-number",
      distance: NaN,
    } as never);
    expect(a.durationSec).toBe(0);
    expect(a.distanceM).toBeUndefined();
  });

  it("falls back to a string activityType when there is no nested typeKey", () => {
    const a = normaliseActivity({ activityType: "indoor_cardio", duration: 900 } as never);
    expect(a.type).toBe("indoor_cardio");
  });
});

describe("activityDisplay", () => {
  it("maps known types to a distinct icon + colour class", () => {
    expect(activityDisplay("running").icon).toBe(Footprints);
    expect(activityDisplay("strength_training").icon).toBe(Dumbbell);
    expect(activityDisplay("cycling").icon).toBe(Bike);
    expect(activityDisplay("lap_swimming").icon).toBe(Waves);
    // distinct colour per type
    const colours = new Set(
      ["running", "strength_training", "cycling", "lap_swimming"].map((t) => activityDisplay(t).colorClass),
    );
    expect(colours.size).toBe(4);
  });

  it("each known type has a non-empty human label", () => {
    expect(activityDisplay("running").label.length).toBeGreaterThan(0);
    expect(activityDisplay("strength_training").label).toBe("Strength");
  });

  it("falls back to a muted Activity icon for an unknown type", () => {
    const d = activityDisplay("paddleboarding");
    expect(d.icon).toBe(Activity);
    expect(d.colorClass).toContain("muted");
    expect(d.label.length).toBeGreaterThan(0);
  });

  it("ACTIVITY_DISPLAY is the same data activityDisplay reads", () => {
    expect(activityDisplay("running")).toBe(ACTIVITY_DISPLAY.running);
  });
});

describe("parseActivitiesJson", () => {
  it("parses a JSON array of activities", () => {
    const arr = [{ type: "running", durationSec: 100 }];
    expect(parseActivitiesJson(JSON.stringify(arr))).toEqual(arr);
  });

  it("returns [] for null/undefined/empty", () => {
    expect(parseActivitiesJson(null)).toEqual([]);
    expect(parseActivitiesJson(undefined)).toEqual([]);
    expect(parseActivitiesJson("")).toEqual([]);
  });

  it("returns [] for malformed JSON (never throws)", () => {
    expect(parseActivitiesJson("{not json")).toEqual([]);
  });

  it("returns [] when the parsed value is not an array", () => {
    expect(parseActivitiesJson(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseActivitiesJson("42")).toEqual([]);
  });
});

describe("fmtActivityDuration", () => {
  it("formats hours + minutes", () => {
    expect(fmtActivityDuration(3600 + 12 * 60)).toBe("1h 12m");
  });
  it("drops the hours part when under an hour", () => {
    expect(fmtActivityDuration(30 * 60)).toBe("30m");
  });
  it("shows seconds only for sub-minute durations", () => {
    expect(fmtActivityDuration(45)).toBe("45s");
    expect(fmtActivityDuration(0)).toBe("0s");
  });
});

describe("fmtActivityDistance", () => {
  it("formats km to one decimal at/above 1000 m", () => {
    expect(fmtActivityDistance(5021)).toBe("5.0 km");
    expect(fmtActivityDistance(1000)).toBe("1.0 km");
  });
  it("formats metres below 1 km", () => {
    expect(fmtActivityDistance(850)).toBe("850 m");
  });
});

describe("GarminActivity type", () => {
  it("is structurally what callers expect", () => {
    const a: GarminActivity = { type: "running", durationSec: 100 };
    expect(a.type).toBe("running");
  });
});
