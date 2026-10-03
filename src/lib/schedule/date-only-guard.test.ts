import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

/**
 * Guard for v1.25.5: Protocol.startDate / endDate / cycleAnchor are date-only
 * (00:00 UTC). Turning one into a server-local day with `startOfDay`, or with a
 * helper that calls it (`daysBetween`, `dayKey`, `weekdayCode`), is wrong west of
 * UTC — read them with `dateOnlyDay` / `dateOnlyKey` (lib/schedule/schedule.ts).
 *
 * A tripwire, not a proof: it scans tracked files for the field passed directly
 * as the first argument. A field renamed on the way in (`anchor`, `start`) is
 * not caught. Skipped outside a git checkout (e.g. a source tarball).
 */
const PATTERN = String.raw`(daysBetween|dayKey|weekdayCode|startOfDay)\((?!dateOnly)[^,)]*\b(startDate|endDate|cycleAnchor)\b`;

/**
 * v1.25.9: the UTC slice (`toISOString().slice(0, 10)`) of a stored field. Right
 * for a 00:00Z value, a day early east of UTC for a server-local midnight (the
 * form the cycle actions wrote before v1.25.9) — use `dateOnlyKey`. `new Date()`
 * (now) is not a stored field and is not matched.
 */
const SLICE_PATTERN = String.raw`\b(startDate|endDate|cycleAnchor)\b[^;\n]*(?<!new Date\(\))\.toISOString\(\)\.slice\(0, ?10\)`;

/**
 * SLICE_PATTERN needs the field name on the line, so it misses a helper that
 * takes the field under another name (`toDateInput(d)`, `dayOf(d)`, `effEnd`).
 * These files read the protocol dates through such helpers and hold no other
 * stored date, so ANY UTC slice in them is banned, except `new Date()` (now)
 * and a dose's `takenAt`.
 */
const PROTOCOL_DATE_FILES = [
  "src/app/actions/protocols.ts",
  "src/app/actions/cycle.ts",
  "src/app/actions/stacks.ts",
  "src/lib/cycle/actions-plan.ts",
  "src/lib/cycle/anchor.ts",
  "src/lib/doses-timeline-core.ts",
  ":(literal)src/app/protocols/[id]/edit/page.tsx",
  "src/app/protocols/gantt/page.tsx",
  "src/app/protocols/page.tsx",
];
const ANY_SLICE = String.raw`^(?!.*takenAt).*(?<!new Date\(\))\.toISOString\(\)\.slice\(0, ?10\)`;

function inGitCheckout(): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function grep(pattern: string, paths: string[] = ["src", ":!*.test.ts"]): string {
  try {
    return execFileSync("git", ["grep", "-n", "-P", pattern, "--", ...paths], { encoding: "utf8" });
  } catch (e) {
    // git grep exits 1 when nothing matches — the passing case.
    if ((e as { status?: number }).status !== 1) throw e;
    return "";
  }
}

describe("date-only protocol fields guard", () => {
  it.skipIf(!inGitCheckout())("no server-local day conversion of startDate|endDate|cycleAnchor outside tests", () => {
    expect(grep(PATTERN)).toBe("");
  });

  it.skipIf(!inGitCheckout())("no UTC slice of startDate|endDate|cycleAnchor outside tests", () => {
    expect(grep(SLICE_PATTERN)).toBe("");
  });

  it.skipIf(!inGitCheckout())("no UTC slice at all in the files that read protocol dates through helpers", () => {
    // A renamed file would make git grep exit 1 (= "no match") and pass silently.
    for (const f of PROTOCOL_DATE_FILES) {
      expect(() => execFileSync("git", ["ls-files", "--error-unmatch", "--", f], { stdio: "ignore" }), f).not.toThrow();
    }
    expect(grep(ANY_SLICE, PROTOCOL_DATE_FILES)).toBe("");
  });
});
