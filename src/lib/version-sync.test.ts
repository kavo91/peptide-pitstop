import { describe, it, expect } from "vitest";
import { APP_VERSION } from "./version";
import pkg from "../../package.json";

/**
 * APP_VERSION is a hand-maintained constant because importing package.json into
 * client-bundled code would inline the whole manifest (dependency list included)
 * into the browser bundle. The cost of that choice is drift: `npm version` bumps
 * package.json and leaves this constant behind.
 *
 * That is not hypothetical — prod shipped v1.6.0 while the footer badge and
 * /api/version both still reported 1.4.9, because three releases bumped
 * package.json and none touched version.ts.
 *
 * This test makes the drift a red build instead of a wrong number in the UI.
 */
describe("APP_VERSION / package.json parity", () => {
  it("matches the package version exactly", () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("is a plain semver string with no leading v", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
