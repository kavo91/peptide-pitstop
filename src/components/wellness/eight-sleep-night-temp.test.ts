import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EightSleepNightTempChart, type NightNav } from "./EightSleepNightTempChart";

const T = (h: number, m = 0) => Date.parse(`2027-10-26T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`);
const nav = (over: Partial<NightNav> = {}): NightNav => ({
  night: "2027-10-27",
  prev: "2027-10-26",
  next: null,
  href: (n) => `/journal/chart/sleep?night=${n}`,
  ...over,
});
const render = (props: Parameters<typeof EightSleepNightTempChart>[0]) =>
  renderToStaticMarkup(createElement(EightSleepNightTempChart, props));

describe("EightSleepNightTempChart (rendered markup)", () => {
  it("draws a bed and a room line with one dot per reading, clock labels in the given zone", () => {
    const html = render({
      temps: { bed: [{ t: T(12), v: 28 }, { t: T(13), v: 30 }], room: [{ t: T(12), v: 21 }, { t: T(13), v: 22 }] },
      nav: nav(),
      timeZone: "Australia/Brisbane",
    });
    expect(html.match(/<path /g)).toHaveLength(2);
    expect(html.match(/<circle /g)).toHaveLength(4);
    expect(html).toContain("Bed · mean of readings 29.0 °C");
    expect(html).toContain("Room · mean of readings 21.5 °C");
    expect(html).toContain("2 bed readings, 2 room readings this night.");
    // 12:00Z = 10:00 pm in Brisbane (UTC+10)
    expect(html).toMatch(/10:00\s?pm/);
  });

  it("breaks the line across a gap longer than 90 minutes", () => {
    const html = render({
      temps: { bed: [{ t: T(12), v: 28 }, { t: T(13), v: 29 }, { t: T(16), v: 29 }], room: [] },
      nav: nav(),
      timeZone: "UTC",
    });
    const d = html.match(/<path d="([^"]+)"/)![1];
    expect(d.match(/M/g)).toHaveLength(2);
    expect(html).not.toContain("Room");
  });

  it("links to the neighbouring nights that exist only", () => {
    const html = render({ temps: null, nav: nav({ prev: "2027-10-26", next: null }) });
    expect(html).toContain('href="/journal/chart/sleep?night=2027-10-26"');
    expect(html).not.toContain("Next night");
  });

  it("shows a plain message when the night has no readings", () => {
    expect(render({ temps: null, nav: nav() })).toContain("No temperature readings for this night.");
    expect(render({ temps: { bed: [], room: [] }, nav: nav() })).toContain("No temperature readings for this night.");
  });

  it("a single reading or all-equal readings draw without NaN", () => {
    const one = render({ temps: { bed: [{ t: T(12), v: 28 }], room: [] }, nav: nav(), timeZone: "UTC" });
    const flat = render({ temps: { bed: [{ t: T(12), v: 28 }, { t: T(13), v: 28 }], room: [{ t: T(12), v: 28 }] }, nav: nav(), timeZone: "UTC" });
    for (const html of [one, flat]) {
      expect(html).not.toContain("NaN");
      expect(html).toContain("<circle ");
    }
  });

  it("two readings at the same instant both render; dense lines get dots only where the line can't reach", () => {
    const same = render({ temps: { bed: [{ t: T(12), v: 28 }, { t: T(12), v: 28.5 }], room: [] }, nav: nav(), timeZone: "UTC" });
    expect(same.match(/<circle /g)).toHaveLength(2);
    const dense = Array.from({ length: 31 }, (_, i) => ({ t: T(10) + i * 60_000, v: 28 }));
    const html = render({ temps: { bed: dense, room: [] }, nav: nav(), timeZone: "UTC" });
    expect(html).not.toContain("<circle ");
    expect(html).toContain("<path ");
    // 31 joined readings, then one alone 3 h later: only the lone one gets a dot.
    const withLone = render({ temps: { bed: [...dense, { t: T(16), v: 29 }], room: [] }, nav: nav(), timeZone: "UTC" });
    expect(withLone.match(/<circle /g)).toHaveLength(1);
  });

  it("says 'reading' for one and 'readings' for more", () => {
    const html = render({ temps: { bed: [{ t: T(12), v: 28 }], room: [{ t: T(12), v: 21 }, { t: T(13), v: 21 }] }, nav: nav(), timeZone: "UTC" });
    expect(html).toContain("1 bed reading, 2 room readings this night.");
  });

  it("uses neutral wording only", () => {
    const html = render({ temps: { bed: [{ t: T(12), v: 28 }], room: [] }, nav: nav(), timeZone: "UTC" }).toLowerCase();
    for (const w of ["should", "better", "worse", "ideal", "too hot", "too cold", "recommend"]) expect(html).not.toContain(w);
  });
});
