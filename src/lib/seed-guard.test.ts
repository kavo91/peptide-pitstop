import { describe, it, expect } from "vitest";
import { isSeedAllowed, assertSeedAllowed } from "./seed-guard";

describe("seed-guard", () => {
  it("allows seeding outside production", () => {
    expect(isSeedAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(isSeedAllowed({})).toBe(true);
    expect(isSeedAllowed({ NODE_ENV: "test" })).toBe(true);
  });

  it("blocks the destructive seed in production by default", () => {
    expect(isSeedAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow(
      /Refusing to run the destructive seed/,
    );
  });

  it("allows production seeding only with the explicit ALLOW_PROD_SEED=1 override", () => {
    expect(isSeedAllowed({ NODE_ENV: "production", ALLOW_PROD_SEED: "1" })).toBe(true);
    expect(() =>
      assertSeedAllowed({ NODE_ENV: "production", ALLOW_PROD_SEED: "1" }),
    ).not.toThrow();
  });

  it("fails closed on any override value other than '1'", () => {
    expect(isSeedAllowed({ NODE_ENV: "production", ALLOW_PROD_SEED: "true" })).toBe(false);
    expect(isSeedAllowed({ NODE_ENV: "production", ALLOW_PROD_SEED: "0" })).toBe(false);
    expect(isSeedAllowed({ NODE_ENV: "production", ALLOW_PROD_SEED: "" })).toBe(false);
  });
});
