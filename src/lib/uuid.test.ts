import { afterEach, describe, expect, it, vi } from "vitest";
import { safeUuid } from "./uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("safeUuid", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses crypto.randomUUID when available (secure context)", () => {
    const randomUUID = vi.fn(() => "11111111-1111-4111-8111-111111111111");
    vi.stubGlobal("crypto", { randomUUID, getRandomValues: crypto.getRandomValues.bind(crypto) });
    expect(safeUuid()).toBe("11111111-1111-4111-8111-111111111111");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("falls back to getRandomValues when randomUUID is absent (non-secure context, e.g. HTTP/LAN)", () => {
    // Simulate a browser served over plain HTTP: randomUUID is undefined, but
    // getRandomValues still works. This is the exact Unraid case that wedged
    // the dose-log button on "Logging…".
    const getRandomValues = vi.fn((arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = i;
      return arr;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    const id = safeUuid();
    expect(id).toMatch(V4);
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it("falls back to Math.random when Web Crypto is entirely absent", () => {
    vi.stubGlobal("crypto", undefined);
    expect(safeUuid()).toMatch(V4);
  });

  it("produces distinct ids across calls (fallback path)", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
        return arr;
      },
    });
    expect(safeUuid()).not.toBe(safeUuid());
  });
});
