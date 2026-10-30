import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EightSleepBlock, GarminBlock } from "./WellnessLog";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");

describe("Today card blocks", () => {
  it("Eight Sleep block: its own tag and metrics, only those present", () => {
    const h = html(
      createElement(EightSleepBlock, {
        e: { sleepSeconds: 26700, score: 84, sleepHrAvg: 54, hrvMs: 47.5, respirationAvg: 15.25, tossTurns: 21, bedTempC: null, roomTempC: null },
      }),
    );
    expect(h).toContain(">Eight Sleep</span>");
    expect(h).toContain("score 84");
    expect(h).toContain("54 bpm");
    expect(h).toContain("HRV (bed sensor)");
    expect(h).toContain("48 ms");
    expect(h).toContain("15.3 /min");
    expect(h).toContain("Toss &amp; turns");
    expect(h).not.toContain("Bed temp");
    expect(h).not.toContain("Garmin");
  });

  it("Garmin block shows weight to 0.1 kg", () => {
    const h = html(
      createElement(GarminBlock, {
        g: {
          sleepSeconds: null, sleepScore: null, weightKg: 80.456, steps: null, caloriesActive: null, intensityMinutes: null,
          restingHr: null, hrvMs: null, bodyBattery: null, activities: [],
        },
      }),
    );
    expect(h).toContain("80.5 kg");
    expect(h).not.toContain("80.456");
  });
});
