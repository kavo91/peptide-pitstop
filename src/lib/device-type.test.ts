import { describe, it, expect } from "vitest";
import { coerceDeviceType, isPump } from "./device-type";

describe("coerceDeviceType", () => {
  it("passes through known values", () => {
    expect(coerceDeviceType("syringe")).toBe("syringe");
    expect(coerceDeviceType("pen")).toBe("pen");
    expect(coerceDeviceType("pump")).toBe("pump");
  });

  it("defaults an unknown/legacy value to syringe", () => {
    expect(coerceDeviceType("insulin-pen")).toBe("syringe");
    expect(coerceDeviceType("")).toBe("syringe");
  });

  it("defaults null/undefined to syringe", () => {
    expect(coerceDeviceType(null)).toBe("syringe");
    expect(coerceDeviceType(undefined)).toBe("syringe");
  });
});

describe("isPump", () => {
  it("is true only for pump", () => {
    expect(isPump("pump")).toBe(true);
    expect(isPump("pen")).toBe(false);
    expect(isPump("syringe")).toBe(false);
    expect(isPump(null)).toBe(false);
    expect(isPump(undefined)).toBe(false);
  });
});
