import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A client form that calls a server action
// must router.refresh() on success, or the vial list and remainingMl stay stale.
// There is no DOM test runner in this repo, so this pins the source contract
// for every log form (LogDoseForm and OralLogForm already comply).
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../components/${rel}`, import.meta.url)), "utf8");

describe("log forms refresh the server tree after a save", () => {
  for (const file of ["AdHocLogForm.tsx", "LogDoseForm.tsx", "OralLogForm.tsx"]) {
    it(`${file} calls router.refresh() when the save is ok and no prompt is pending`, () => {
      // Strip comments so a commented-out call cannot satisfy the contract.
      const src = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(src).toMatch(/useRouter\(\)/);
      expect(src).toMatch(/if \(!res\.rebase && !res\.advance\) router\.refresh\(\);/);
    });
  }
});
