import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// A legacy dose row (localDay null) must bucket by the
// runtime-local day everywhere, via `doseDayKey`. The edit page, the shift
// loader and the shift action share the titration carry-forward maths, so a
// UTC-date fallback left in any one of them makes them disagree again.
const SRC = fileURLToPath(new URL("..", import.meta.url));
const UTC_FALLBACK = /localDay\s*\?\?\s*(?:new Date\()?[\w.]*takenAt\)?\.toISOString\(\)\.slice\(0,\s*10\)/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

describe("no UTC-date fallback for legacy dose rows", () => {
  it("no source file derives a legacy row's day from the UTC date of takenAt", () => {
    const hits = files(SRC).filter((f) => UTC_FALLBACK.test(readFileSync(f, "utf8"))).map((f) => f.slice(SRC.length));
    expect(hits).toEqual([]);
  });
});
