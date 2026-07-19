import { describe, it, expect } from "vitest";
import { asOfLabel } from "./wellness-label";

// Runtime TZ is pinned to Australia/Brisbane (vitest.config.ts). The viewer
// key is an INPUT — the whole point is that the label follows the viewer's
// day, not the runtime clock.
describe("asOfLabel", () => {
  it("labels the viewer's own day as Today (even when the runtime day differs)", () => {
    // Example: wearable snapshot as-of 2026-07-18; a viewer west of the runtime
    // zone is still on the 18th while the runtime is already on the 19th.
    expect(asOfLabel("2026-07-18", "2026-07-18")).toEqual({ text: "Today", stale: false });
  });
  it("labels one day before the viewer's key as Yesterday (stale)", () => {
    expect(asOfLabel("2026-07-18", "2026-07-19")).toEqual({ text: "Yesterday", stale: true });
  });
  it("handles month boundaries in the yesterday derivation", () => {
    expect(asOfLabel("2026-07-31", "2026-08-01")).toEqual({ text: "Yesterday", stale: true });
    expect(asOfLabel("2026-12-31", "2027-01-01")).toEqual({ text: "Yesterday", stale: true });
  });
  it("falls back to D Mon for anything older", () => {
    expect(asOfLabel("2026-07-15", "2026-07-18")).toEqual({ text: "15 Jul", stale: true });
  });
});
