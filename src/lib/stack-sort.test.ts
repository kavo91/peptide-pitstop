import { describe, expect, it } from "vitest";
import { compareStackGrouped } from "./stack-sort";

describe("compareStackGrouped", () => {
  it("keeps stack components adjacent by stack name, then component peptide", () => {
    const rows = [
      { peptideName: "MOTS-c" },
      { peptideName: "BPC-157", stackId: "s1", stackName: "Glow stack" },
      { peptideName: "TA1" },
      { peptideName: "TB-500", stackId: "s1", stackName: "Glow stack" },
      { peptideName: "GHK-Cu", stackId: "s1", stackName: "Glow stack" },
    ];

    expect([...rows].sort(compareStackGrouped).map((r) => r.peptideName)).toEqual([
      "BPC-157",
      "GHK-Cu",
      "TB-500",
      "MOTS-c",
      "TA1",
    ]);
  });
});
