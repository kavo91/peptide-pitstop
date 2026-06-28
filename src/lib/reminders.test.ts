import { describe, it, expect } from "vitest";
import { dueReminders, REMINDER_GRACE_MINUTES, type ReminderCandidate } from "./reminders";

// ─── helpers ───────────────────────────────────────────────────────────────

const MIN = 60_000;

/** Build a candidate at `offsetMinutes` relative to `now`. */
function cand(
  offsetMinutes: number,
  overrides: Partial<ReminderCandidate> = {},
  now = NOW,
): ReminderCandidate {
  return {
    scheduledAt: new Date(now.getTime() + offsetMinutes * MIN),
    status: "planned",
    reminderSentAt: null,
    ...overrides,
  };
}

const NOW = new Date("2026-06-21T06:00:00+10:00");
const LOOKAHEAD = 30;

// ─── suite: window membership ───────────────────────────────────────────────

describe("dueReminders — window membership", () => {
  it("includes a planned, un-reminded dose due within the lookahead", () => {
    const c = cand(10);
    expect(dueReminders([c], NOW, LOOKAHEAD)).toEqual([c]);
  });

  it("includes a dose due exactly at now", () => {
    const c = cand(0);
    expect(dueReminders([c], NOW, LOOKAHEAD)).toEqual([c]);
  });

  it("includes a dose at exactly now + lookahead (inclusive upper bound)", () => {
    const c = cand(LOOKAHEAD);
    expect(dueReminders([c], NOW, LOOKAHEAD)).toEqual([c]);
  });

  it("excludes a dose just past the lookahead", () => {
    const c = cand(LOOKAHEAD + 1);
    expect(dueReminders([c], NOW, LOOKAHEAD)).toEqual([]);
  });

  it("includes a recently-past dose still inside the grace window", () => {
    const c = cand(-(REMINDER_GRACE_MINUTES - 1));
    expect(dueReminders([c], NOW, LOOKAHEAD)).toEqual([c]);
  });

  it("includes a dose at exactly now - grace (inclusive lower bound)", () => {
    const c = cand(-REMINDER_GRACE_MINUTES);
    expect(dueReminders([c], NOW, LOOKAHEAD)).toEqual([c]);
  });

  it("excludes a dose older than the grace window", () => {
    const c = cand(-(REMINDER_GRACE_MINUTES + 1));
    expect(dueReminders([c], NOW, LOOKAHEAD)).toEqual([]);
  });
});

// ─── suite: status / already-sent filters ───────────────────────────────────

describe("dueReminders — status and idempotency filters", () => {
  it.each(["taken", "missed", "skipped"])(
    "excludes a dose with status %s even when in-window",
    (status) => {
      const c = cand(10, { status });
      expect(dueReminders([c], NOW, LOOKAHEAD)).toEqual([]);
    },
  );

  it("excludes a dose that already has reminderSentAt set", () => {
    const c = cand(10, { reminderSentAt: new Date("2026-06-21T05:55:00+10:00") });
    expect(dueReminders([c], NOW, LOOKAHEAD)).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(dueReminders([], NOW, LOOKAHEAD)).toEqual([]);
  });
});

// ─── suite: mixed set + generic passthrough ─────────────────────────────────

describe("dueReminders — mixed sets", () => {
  it("returns only the due subset from a mixed batch", () => {
    const due1 = cand(5);
    const due2 = cand(20);
    const tooFar = cand(120);
    const tooOld = cand(-120);
    const alreadySent = cand(10, { reminderSentAt: NOW });
    const notPlanned = cand(10, { status: "taken" });

    const result = dueReminders(
      [due1, tooFar, due2, tooOld, alreadySent, notPlanned],
      NOW,
      LOOKAHEAD,
    );
    expect(result).toEqual([due1, due2]);
  });

  it("preserves caller-supplied extra fields on returned objects (generic)", () => {
    type Rich = ReminderCandidate & { id: string; peptide: string };
    const rich: Rich = { ...cand(10), id: "pd-1", peptide: "Retatrutide" };
    const [out] = dueReminders([rich], NOW, LOOKAHEAD);
    expect(out.id).toBe("pd-1");
    expect(out.peptide).toBe("Retatrutide");
  });
});
