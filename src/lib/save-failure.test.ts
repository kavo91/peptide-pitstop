import { describe, expect, it } from "vitest";
import { SAVE_FAILED_MESSAGE } from "./save-failure";

describe("SAVE_FAILED_MESSAGE", () => {
  it("starts with the generic save failure", () => {
    expect(SAVE_FAILED_MESSAGE.startsWith("Could not save.")).toBe(true);
  });
  it("names the signed-out cause and both remedies", () => {
    expect(SAVE_FAILED_MESSAGE).toContain("signed out");
    expect(SAVE_FAILED_MESSAGE).toContain("reload");
    expect(SAVE_FAILED_MESSAGE).toContain("check whether it saved");
  });
});
