import { describe, it, expect } from "vitest";
import { GET } from "./route";
import { APP_VERSION } from "@/lib/version";

describe("GET /api/version", () => {
  it("returns the running app version, uncached", async () => {
    const res = GET();
    expect(res.headers.get("cache-control")).toContain("no-store");
    await expect(res.json()).resolves.toEqual({ version: APP_VERSION });
  });
});
