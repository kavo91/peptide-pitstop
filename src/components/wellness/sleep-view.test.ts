import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SleepMainCard } from "./SleepCards";
import { SleepExtraCards } from "./SleepExtraCards";
import { SleepCompareCard } from "./SleepCompareCard";
import { ChartDetail } from "./ChartDetail";
import { buildWearableSeries, type WearableDailyLike } from "@/lib/wearable-series";
import { buildEightSleepSeries, type EightSleepRowLike } from "@/lib/eight-sleep-series";
import { pairSleepNights } from "@/lib/sleep-pairs";
import { compareSleep } from "@/lib/sleep-compare";
import { buildChartSeries, sleepSeriesOptions } from "@/lib/chart-detail-config";

const d = (i: number) => new Date(2026, 5, 10 + i);

const garminRows = (n: number): WearableDailyLike[] =>
  Array.from({ length: n }, (_, i) => ({
    date: d(i),
    sleepSeconds: 25000 + i * 60,
    sleepDeepSeconds: 5000,
    sleepLightSeconds: 15000,
    sleepRemSeconds: 5000 + i * 60,
    sleepAwakeSeconds: 900,
    sleepScore: 75 + i,
    hrvMs: 60,
    mergedSource: "garmin",
  }));

const eightRows = (n: number): EightSleepRowLike[] =>
  Array.from({ length: n }, (_, i) => ({
    date: d(i),
    sleepSeconds: 26000 + i * 60,
    sleepDeepSeconds: 5400,
    sleepLightSeconds: 15000,
    sleepRemSeconds: 5600 + i * 60,
    sleepAwakeSeconds: 2000,
    sleepScore: 80 + i,
    hrvMs: 45,
    tossTurns: 15 + i,
    sleepHrAvg: 52 + (i % 3),
  }));

const EMPTY_WATCH = buildWearableSeries([]);
const EMPTY_EIGHT = buildEightSleepSeries([]);
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el).replace(/<script[\s\S]*?<\/script>/g, "");
const count = (h: string, s: string) => h.split(s).length - 1;

const PAIR_LABEL = "Nightly sleep, Garmin and Eight Sleep side by side";
const GARMIN_LABEL = "Nightly sleep stages and sleep score";

describe("SleepMainCard — picks the card for the devices that have nights", () => {
  it("Garmin only → the Garmin Sleep chart, unchanged", () => {
    const h = html(createElement(SleepMainCard, { watch: buildWearableSeries(garminRows(3)), eightSleep: EMPTY_EIGHT }));
    expect(count(h, ">Sleep</h3>")).toBe(1);
    expect(count(h, GARMIN_LABEL)).toBe(1);
    expect(h).not.toContain("Eight Sleep");
    expect(count(h, "<rect ")).toBe(12); // 3 nights × 4 stages
  });

  it("Eight Sleep only → 'Sleep · Eight Sleep', no Garmin bars", () => {
    const h = html(createElement(SleepMainCard, { watch: EMPTY_WATCH, eightSleep: buildEightSleepSeries(eightRows(3)) }));
    expect(count(h, "Sleep · Eight Sleep")).toBe(1);
    expect(h).not.toContain(PAIR_LABEL);
    expect(count(h, "<rect ")).toBe(12);
  });

  it("both → one Sleep chart with two bars per night, one outlined, and two score lines", () => {
    const h = html(
      createElement(SleepMainCard, {
        watch: buildWearableSeries(garminRows(3)),
        eightSleep: buildEightSleepSeries(eightRows(3)),
        detailHref: "/journal/chart/sleep",
      }),
    );
    expect(count(h, ">Sleep</h3>")).toBe(1);
    expect(count(h, PAIR_LABEL)).toBe(1);
    expect(count(h, 'fill="none" stroke="rgb(var(--ink))"')).toBe(3); // one outline per Eight Sleep bar
    expect(count(h, "<rect ")).toBe(3 * 4 * 2 + 3);
    expect(h).toContain("Garmin 7.0 h");
    expect(h).toContain("Eight Sleep 7.2 h");
    expect(count(h, 'stroke-dasharray="4 3"')).toBe(2); // Eight Sleep score line is dashed, plus its legend sample
    expect(h).toContain("Garmin score");
    expect(h).toContain("Eight Sleep score");
    expect(h).toContain('href="/journal/chart/sleep"');
  });

  it("both, but a night only one device saw → that night has one bar", () => {
    const h = html(
      createElement(SleepMainCard, {
        watch: buildWearableSeries(garminRows(2)),
        eightSleep: buildEightSleepSeries(eightRows(1)),
      }),
    );
    expect(count(h, 'fill="none" stroke="rgb(var(--ink))"')).toBe(1);
    expect(count(h, "<rect ")).toBe(2 * 4 + 1 * 4 + 1);
  });

  it("neither → the existing empty Sleep card", () => {
    const h = html(createElement(SleepMainCard, { watch: EMPTY_WATCH }));
    expect(h).toContain("No data in this window.");
  });
});

describe("SleepCompareCard + SleepExtraCards", () => {
  it("both devices: coverage, per-metric averages with n, signed difference, HRV side by side", () => {
    const c = compareSleep(pairSleepNights(buildWearableSeries(garminRows(3)), buildEightSleepSeries(eightRows(3))));
    const h = html(createElement(SleepCompareCard, { comparison: c, days: 90 }));
    expect(h).toContain("Garmin vs Eight Sleep");
    expect(h).toContain("3 nights both · 0 Garmin only · 0 Eight Sleep only");
    expect(h).toContain("Time asleep <span");
    expect(h).toContain("n=3");
    expect(h).toContain("+17 m"); // 26060 − 25060 avg seconds
    expect(h).toContain("different sensors");
    expect(h).toContain("60 ms");
    expect(h).toContain("45 ms");
    expect(h).toContain("Not enough nights yet (1 of 5 in each group)");
    expect(h).not.toContain("Pattern, not cause");
  });

  it("enough nights → patterns print with n and the label", () => {
    const c = compareSleep(pairSleepNights(buildWearableSeries(garminRows(12)), buildEightSleepSeries(eightRows(12))));
    const h = html(createElement(SleepCompareCard, { comparison: c, days: 90 }));
    expect(count(h, "Pattern, not cause:")).toBeGreaterThanOrEqual(1);
    expect(h).toMatch(/\(n=6\)/);
  });

  it("no shared night → says so, still lists coverage", () => {
    const watch = buildWearableSeries(garminRows(1));
    const eight = buildEightSleepSeries([{ ...eightRows(1)[0], date: d(5) }]);
    const h = html(createElement(SleepCompareCard, { comparison: compareSleep(pairSleepNights(watch, eight)), days: 90 }));
    expect(h).toContain("0 nights both · 1 Garmin only · 1 Eight Sleep only");
    expect(h).toContain("No night with both devices yet.");
  });

  it("extra cards: comparison only when both devices have data; bed card only with Eight Sleep nights", () => {
    const garminOnly = compareSleep(pairSleepNights(buildWearableSeries(garminRows(3)), EMPTY_EIGHT));
    const h1 = html(createElement(SleepExtraCards, { eightSleep: EMPTY_EIGHT, comparison: garminOnly, comparisonDays: 90 }));
    expect(h1).toBe("");

    const eight = buildEightSleepSeries(eightRows(3));
    const eightOnly = compareSleep(pairSleepNights(EMPTY_WATCH, eight));
    const h2 = html(createElement(SleepExtraCards, { eightSleep: eight, comparison: eightOnly, comparisonDays: 90 }));
    expect(h2).toContain("Bed · Eight Sleep");
    expect(h2).not.toContain("Garmin vs Eight Sleep");

    const both = compareSleep(pairSleepNights(buildWearableSeries(garminRows(3)), eight));
    const h3 = html(createElement(SleepExtraCards, { eightSleep: eight, comparison: both, comparisonDays: 90 }));
    expect(count(h3, "Garmin vs Eight Sleep")).toBe(1);
    expect(count(h3, "Bed · Eight Sleep")).toBe(1);
  });
});

describe("ChartDetail sleep page — 3 data cases", () => {
  const render = (watch: ReturnType<typeof buildWearableSeries>, eight: ReturnType<typeof buildEightSleepSeries>) => {
    const pairs = pairSleepNights(watch, eight);
    const has = { garmin: pairs.some((p) => p.garmin), eightSleep: pairs.some((p) => p.eightSleep) };
    return html(
      createElement(ChartDetail, {
        chart: "sleep",
        series: watch,
        options: sleepSeriesOptions(has),
        data: buildChartSeries("sleep", watch, eight),
        eightSleep: eight,
      }),
    );
  };

  it("Garmin only: Garmin chart and the original focus labels", () => {
    const h = render(buildWearableSeries(garminRows(3)), EMPTY_EIGHT);
    expect(count(h, GARMIN_LABEL)).toBe(1);
    expect(h).toContain(">Sleep score<");
    expect(h).toContain(">Sleep hours<");
    expect(h).not.toContain("Eight Sleep");
  });

  it("Eight Sleep only: Eight Sleep chart and only Eight Sleep focus options", () => {
    const h = render(EMPTY_WATCH, buildEightSleepSeries(eightRows(3)));
    expect(count(h, "Sleep · Eight Sleep")).toBe(1);
    expect(h).toContain(">Eight Sleep score<");
    expect(h).not.toContain(">Garmin score<");
  });

  it("both, long history: the default 30-night range cuts both devices at the same first date", () => {
    // Garmin has 40 nights from day 0; Eight Sleep only the last 20 (from day 20).
    const watch = buildWearableSeries(garminRows(40));
    const eight = buildEightSleepSeries(eightRows(40).slice(20));
    const h = render(watch, eight);
    // 30 nights kept: days 10..39 → Garmin bars on all 30, Eight Sleep outlines on its 20.
    expect(count(h, 'fill="none" stroke="rgb(var(--ink))"')).toBe(20);
    expect(count(h, "<rect ")).toBe(30 * 4 + 20 * 4 + 20);
    expect(h).toContain(">20 Jun<"); // first night shown = day 10 (2026-06-20)
  });

  it("both: side-by-side chart and four device-named focus options", () => {
    const h = render(buildWearableSeries(garminRows(3)), buildEightSleepSeries(eightRows(3)));
    expect(count(h, PAIR_LABEL)).toBe(1);
    for (const l of ["Garmin score", "Garmin hours", "Eight Sleep score", "Eight Sleep hours"]) expect(h).toContain(`>${l}<`);
  });
});
