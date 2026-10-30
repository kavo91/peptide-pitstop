import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EightSleepBedCard } from "./EightSleepBedCard";
import { SleepChart } from "./SleepChart";
import { buildEightSleepSeries } from "@/lib/eight-sleep-series";

const d = (s: string) => {
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y, m - 1, day);
};

const series = buildEightSleepSeries([
  {
    date: d("2026-06-19"),
    sleepSeconds: 25000,
    sleepDeepSeconds: 5000,
    sleepLightSeconds: 15000,
    sleepRemSeconds: 5000,
    sleepAwakeSeconds: 2000,
    sleepScore: 78,
    sleepHrAvg: 56,
    tossTurns: 25,
    hrvMs: 61.5,
  },
  {
    date: d("2026-06-20"),
    sleepSeconds: 27600,
    sleepDeepSeconds: 6000,
    sleepLightSeconds: 15000,
    sleepRemSeconds: 6600,
    sleepAwakeSeconds: 3000,
    sleepScore: 84,
    sleepHrAvg: 54,
    tossTurns: 21,
  },
]);

describe("Eight Sleep cards (rendered markup)", () => {
  it("bed card: last night + window average, — for unknown, hides metrics with no data", () => {
    const html = renderToStaticMarkup(createElement(EightSleepBedCard, { nights: series.nights }));
    expect(html).toContain("Bed · Eight Sleep");
    expect(html).toContain("last night 20 Jun");
    expect(html).toContain("2-night avg");
    expect(html).toContain("Sleeping heart rate");
    expect(html).toContain("54 bpm"); // last night
    expect(html).toContain("55 bpm"); // avg of 56, 54
    expect(html).toContain("Toss &amp; turns");
    // HRV only on the earlier night: last night prints "—", the average still shows 62.
    expect(html).toMatch(/HRV \(bed sensor\)<\/td><td[^>]*>—<\/td><td[^>]*>62 ms</);
    expect(html).not.toContain("Bed temperature"); // no night has it → row hidden
    expect(html).not.toContain("$0");
  });

  it("bed card: empty state when there are no nights", () => {
    const html = renderToStaticMarkup(createElement(EightSleepBedCard, { nights: [] }));
    expect(html).toContain("No data in this window.");
  });

  it("sleep chart reused under the Eight Sleep title", () => {
    const html = renderToStaticMarkup(createElement(SleepChart, { sleep: series.sleep, title: "Sleep · Eight Sleep" }));
    expect(html).toContain("Sleep · Eight Sleep");
    expect(html).toContain("score 81");
    expect((html.match(/<rect /g) ?? []).length).toBe(8); // 2 nights × 4 stages
  });

  it("Garmin's sleep chart keeps its default title", () => {
    const html = renderToStaticMarkup(createElement(SleepChart, { sleep: series.sleep }));
    expect(html).toContain(">Sleep</h3>");
  });
});
