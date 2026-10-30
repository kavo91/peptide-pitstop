import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BodyCompositionChart } from "./BodyCompositionChart";

const render = (weight: { date: string; weightKg: number }[], detailHref?: string) =>
  renderToStaticMarkup(createElement(BodyCompositionChart, { weight, detailHref })).replace(/<!-- -->/g, "");

describe("BodyCompositionChart", () => {
  it("one weigh-in: 0.1 kg, its date, and the View link to the longer trend", () => {
    const h = render([{ date: "2027-10-26", weightKg: 80.456 }], "/journal/chart/body");
    expect(h).toContain("80.5<span");
    expect(h).not.toContain("80.456");
    expect(h).toContain("One weigh-in this week (26 Oct). Open View for the longer trend.");
    expect(h).toContain('href="/journal/chart/body"');
  });

  it("one weigh-in without a link says nothing about View", () => {
    const h = render([{ date: "2027-10-26", weightKg: 80.456 }]);
    expect(h).toContain("One weigh-in this week (26 Oct).");
    expect(h).not.toContain("Open View");
  });

  it("several weigh-ins: latest, delta and axis labels all to 0.1 kg", () => {
    const h = render([
      { date: "2027-10-20", weightKg: 81.125 },
      { date: "2027-10-26", weightKg: 80.456 },
    ]);
    expect(h).toContain("80.5 kg · -0.7 kg");
    expect(h).toContain(">81.1</text>");
    expect(h).toContain(">80.5</text>");
    expect(h).not.toMatch(/80\.456|81\.125/);
  });
});
