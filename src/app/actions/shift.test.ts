import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  protocolFindFirst,
  protocolUpdateMany,
  doseLogFindMany,
  auditLogCreate,
  currentUser,
  revalidatePath,
  reviseProtocol,
  viewerToday,
} = vi.hoisted(() => ({
  protocolFindFirst: vi.fn(),
  protocolUpdateMany: vi.fn(),
  doseLogFindMany: vi.fn(),
  auditLogCreate: vi.fn(),
  currentUser: vi.fn(),
  revalidatePath: vi.fn(),
  reviseProtocol: vi.fn(),
  viewerToday: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    protocol: { findFirst: protocolFindFirst, updateMany: protocolUpdateMany },
    doseLog: { findMany: doseLogFindMany },
    auditLog: { create: auditLogCreate },
  },
}));

vi.mock("@/lib/auth/owner", () => ({ getCurrentUser: currentUser }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/viewer-tz", () => ({ viewerToday }));
// Only reviseProtocol is faked — everything else this file needs
// (shiftFingerprint, rotatedRule) is imported straight from the real,
// UNMOCKED @/lib/schedule/shift-suggest engine, per the house rule that the
// fingerprint/rotation math in these tests must be genuine.
vi.mock("@/app/actions/protocols", () => ({ reviseProtocol }));

import { applyShiftSuggestion, applyShiftPlan, pinShiftSuggestion } from "./shift";
import { shiftFingerprint, rotatedRule } from "@/lib/schedule/shift-suggest";

// Local-midnight construction for viewer "today" / day-key inputs — same
// house style as shift-suggest.test.ts (vitest pins TZ=Australia/Brisbane).
const D = (y: number, m: number, d: number) => new Date(y, m - 1, d);
// Date-only ISO strings parse as UTC midnight (ECMA-262) — the same
// construction protocols.ts uses for every stored Protocol date field
// (`new Date(input.startDate)`, `new Date(`${d}T00:00:00.000Z`)`), so DB-row
// mocks use this form rather than local-midnight `D()`.
const U = (key: string) => new Date(key);

const VIEWER_KEY = "2026-09-04"; // Fri
const VIEWER_DATE = D(2026, 9, 4);

const weeklyRule = (byDays: string[], times: string[] = []) =>
  JSON.stringify([{ dayPattern: { kind: "weekly", byDays }, times }]);

const VALID_FINGERPRINT = "a".repeat(64);
const VALID_INPUT = { protocolId: "p1", k: 1, startDate: "2026-09-05", fingerprint: VALID_FINGERPRINT };

beforeEach(() => {
  vi.clearAllMocks();
  viewerToday.mockResolvedValue({ key: VIEWER_KEY, date: VIEWER_DATE });
});

describe("applyShiftSuggestion — input validation (no DB call)", () => {
  const cases: [string, Partial<typeof VALID_INPUT>][] = [
    ["k = 0", { k: 0 }],
    ["k = 7", { k: 7 }],
    ["k = 1.5", { k: 1.5 }],
    ["k as a string", { k: "1" as unknown as number }],
    ["startDate malformed", { startDate: "09/05/2026" }],
    ["startDate before today", { startDate: "2026-09-03" }],
    ["startDate more than 14 days out", { startDate: "2026-09-19" }],
    ["startDate an impossible calendar day", { startDate: "2026-02-31" }],
    ["fingerprint wrong length", { fingerprint: "a".repeat(63) }],
    ["fingerprint non-hex", { fingerprint: "g".repeat(64) }],
  ];

  it.each(cases)("%s → code:invalid", async (_label, override) => {
    const res = await applyShiftSuggestion({ ...VALID_INPUT, ...override });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("invalid");
    expect(protocolFindFirst).not.toHaveBeenCalled();
  });

  it("startDate exactly today, and exactly today+14, are both valid dates (boundary)", async () => {
    currentUser.mockResolvedValue(null); // fail later, at auth — proves validation passed
    await applyShiftSuggestion({ ...VALID_INPUT, startDate: "2026-09-04" });
    await applyShiftSuggestion({ ...VALID_INPUT, startDate: "2026-09-18" });
    expect(currentUser).toHaveBeenCalledTimes(2);
  });
});

// A POST body of `[]` or `[null]` makes `input`
// undefined/null; dereferencing `raw.protocolId` on that before the try block
// used to throw a TypeError → HTTP 500 instead of a normal `{ ok: false }`.
describe("applyShiftSuggestion — malformed input shape, not just malformed fields", () => {
  const shapes: [string, unknown][] = [
    ["undefined", undefined],
    ["null", null],
    ["an array", []],
    ["a plain string", "x"],
  ];

  it.each(shapes)("input is %s → code:invalid, no DB call", async (_label, value) => {
    const res = await applyShiftSuggestion(value as never);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("invalid");
    expect(!res.ok && res.error).toBe("Invalid request.");
    expect(currentUser).not.toHaveBeenCalled();
    expect(protocolFindFirst).not.toHaveBeenCalled();
  });
});

describe("applyShiftSuggestion — auth and lookup", () => {
  it("not signed in → code:auth, no DB call", async () => {
    currentUser.mockResolvedValue(null);
    const res = await applyShiftSuggestion(VALID_INPUT);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("auth");
    expect(protocolFindFirst).not.toHaveBeenCalled();
  });

  it("protocol not found (or not active — same scoped query) → code:not_found", async () => {
    currentUser.mockResolvedValue({ id: "user-1" });
    protocolFindFirst.mockResolvedValue(null);
    const res = await applyShiftSuggestion(VALID_INPUT);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("not_found");
    expect(protocolFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1", userId: "user-1", status: "active" } }),
    );
    expect(reviseProtocol).not.toHaveBeenCalled();
  });
});

describe("applyShiftSuggestion — fingerprint", () => {
  const ROW = {
    id: "p1",
    userId: "user-1",
    peptideId: "pep-1",
    prescriptionId: null,
    stackId: null,
    name: "Retatrutide",
    source: "manual",
    scheduleType: "titration",
    scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]),
    rebaseMode: "fixed_anchor",
    adherenceWindowMin: 120,
    defaultSyringeId: null,
    targetDose: "300",
    doseInputUnit: "mcg",
    doseBasis: "per_injection",
    startDate: U("2026-01-05"),
    endDate: U("2026-12-31"),
    status: "active",
    cycleOnWeeks: null,
    cycleOffWeeks: null,
    cycleAnchor: null,
    shiftPinned: false,
    steps: [],
    peptide: { name: "Retatrutide" },
  };

  it("fingerprint computed for a different k than requested → code:changed, reviseProtocol not called", async () => {
    currentUser.mockResolvedValue({ id: "user-1" });
    protocolFindFirst.mockResolvedValue(ROW);
    const fingerprintForK1 = shiftFingerprint({
      protocolId: ROW.id,
      scheduleRule: ROW.scheduleRule,
      startDate: ROW.startDate,
      k: 1,
    });

    const res = await applyShiftSuggestion({
      protocolId: "p1",
      k: 2,
      startDate: "2026-09-05",
      fingerprint: fingerprintForK1,
    });

    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("changed");
    expect(!res.ok && res.error).toBe(
      "The schedule changed since this suggestion was made. Refresh to see the current one.",
    );
    expect(reviseProtocol).not.toHaveBeenCalled();
  });
});

describe("applyShiftSuggestion — eligibility re-check", () => {
  const BASE = {
    id: "p1",
    userId: "user-1",
    peptideId: "pep-1",
    prescriptionId: null,
    name: "Retatrutide",
    source: "manual",
    scheduleType: "titration",
    scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]),
    rebaseMode: "fixed_anchor",
    adherenceWindowMin: 120,
    defaultSyringeId: null,
    targetDose: "300",
    doseInputUnit: "mcg",
    doseBasis: "per_injection",
    startDate: U("2026-01-05"),
    endDate: U("2026-12-31"),
    status: "active",
    cycleOnWeeks: null,
    cycleOffWeeks: null,
    cycleAnchor: null,
    stackId: null as string | null,
    shiftPinned: false,
    steps: [],
    peptide: { name: "Retatrutide" },
  };

  async function attemptOn(row: typeof BASE) {
    currentUser.mockResolvedValue({ id: "user-1" });
    protocolFindFirst.mockResolvedValue(row);
    const fingerprint = shiftFingerprint({
      protocolId: row.id,
      scheduleRule: row.scheduleRule,
      startDate: row.startDate,
      k: 1,
    });
    return applyShiftSuggestion({ protocolId: row.id, k: 1, startDate: "2026-09-05", fingerprint });
  }

  it("stackId set → code:ineligible, reviseProtocol not called", async () => {
    const res = await attemptOn({ ...BASE, stackId: "stack-1" });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("ineligible");
    expect(!res.ok && res.error).toBe("This protocol is in a stack, so it is not eligible.");
    expect(reviseProtocol).not.toHaveBeenCalled();
  });

  it("shiftPinned true → code:ineligible", async () => {
    const res = await attemptOn({ ...BASE, shiftPinned: true });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("ineligible");
    expect(!res.ok && res.error).toBe("This protocol is kept as is.");
    expect(reviseProtocol).not.toHaveBeenCalled();
  });

  it("course ends 3 days out → code:ineligible (ends_soon)", async () => {
    const res = await attemptOn({ ...BASE, endDate: U("2026-09-07") });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("ineligible");
    expect(!res.ok && res.error).toBe("This course ends within a week.");
    expect(reviseProtocol).not.toHaveBeenCalled();
  });

  it("a daily (7-day) rule → code:ineligible (not a weekly pattern)", async () => {
    const res = await attemptOn({ ...BASE, scheduleRule: weeklyRule(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]) });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("ineligible");
    expect(!res.ok && res.error).toBe("This protocol's schedule is not a weekly pattern.");
    expect(reviseProtocol).not.toHaveBeenCalled();
  });
});

// The same Mon–Fri-ending-Friday-14-days-out shape as the dose-count fixture
// in shift-suggest.test.ts (today Fri 2026-09-04, course ends Fri 2026-09-18)
// — k=5 drops a dose over the 28-day horizon, k=3 does not. This re-check
// happens AFTER the ordinary eligibility re-check above (the row is eligible
// for every k; only the dose count differs), so it is its own describe block.
describe("applyShiftSuggestion — rotationPreservesCount re-check at the Apply boundary", () => {
  const ROW = {
    id: "p1",
    userId: "user-1",
    peptideId: "pep-1",
    prescriptionId: null,
    stackId: null,
    name: "short",
    source: "manual",
    scheduleType: "fixed_times",
    scheduleRule: weeklyRule(["MO", "TU", "WE", "TH", "FR"], ["07:00"]),
    rebaseMode: "fixed_anchor",
    adherenceWindowMin: 120,
    defaultSyringeId: null,
    targetDose: "300",
    doseInputUnit: "mcg",
    doseBasis: "per_injection",
    startDate: U("2026-08-25"),
    endDate: U("2026-09-18"), // Friday, 14 days out from VIEWER_DATE
    status: "active",
    cycleOnWeeks: null,
    cycleOffWeeks: null,
    cycleAnchor: null,
    shiftPinned: false,
    steps: [],
    peptide: { name: "short" },
  };

  async function attempt(k: number) {
    currentUser.mockResolvedValue({ id: "user-1" });
    protocolFindFirst.mockResolvedValue(ROW);
    doseLogFindMany.mockResolvedValue([]);
    reviseProtocol.mockResolvedValue({ ok: true, id: "successor-short" });
    const fingerprint = shiftFingerprint({
      protocolId: ROW.id,
      scheduleRule: ROW.scheduleRule,
      startDate: ROW.startDate,
      k,
    });
    return applyShiftSuggestion({ protocolId: ROW.id, k, startDate: "2026-09-05", fingerprint });
  }

  it("k=5 (drops a dose) → code:ineligible, reviseProtocol not called", async () => {
    const res = await attempt(5);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("ineligible");
    expect(!res.ok && res.error).toBe("That rotation would change the number of doses in the next four weeks.");
    expect(reviseProtocol).not.toHaveBeenCalled();
  });

  it("k=3 (count-preserving) → proceeds to reviseProtocol", async () => {
    const res = await attempt(3);
    expect(res.ok).toBe(true);
    expect(reviseProtocol).toHaveBeenCalledTimes(1);
  });
});

describe("applyShiftSuggestion — happy path", () => {
  // Mon/Wed/Fri 07:00 titration, 3 steps returned UNSORTED (as protocolStep
  // rows come back), 5 delivered days.
  const HAPPY_ROW = {
    id: "p1",
    userId: "user-1",
    peptideId: "pep-1",
    prescriptionId: "rx-1",
    stackId: null,
    name: "Retatrutide",
    source: "manual",
    scheduleType: "titration",
    scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]),
    rebaseMode: "fixed_anchor",
    adherenceWindowMin: 120,
    defaultSyringeId: "syr-1",
    targetDose: "300",
    doseInputUnit: "mcg",
    doseBasis: "per_injection",
    startDate: U("2026-01-05"),
    endDate: U("2026-12-31"),
    status: "active",
    cycleOnWeeks: null,
    cycleOffWeeks: null,
    cycleAnchor: null,
    shiftPinned: false,
    steps: [
      { stepIndex: 2, dose: "300", doseInputUnit: "mcg", durationDays: null, notes: null },
      { stepIndex: 0, dose: "100", doseInputUnit: "mcg", durationDays: 7, notes: null },
      { stepIndex: 1, dose: "200", doseInputUnit: "mcg", durationDays: 7, notes: null },
    ],
    peptide: { name: "Retatrutide" },
  };

  // Ascending tracking-day keys (Mon/Wed/Fri), as prisma.doseLog.findMany
  // with orderBy: { takenAt: "asc" } would return them.
  const DELIVERED_ROWS = [
    { takenAt: new Date("2026-08-24T21:00:00.000Z"), localDay: "2026-08-24" },
    { takenAt: new Date("2026-08-26T21:00:00.000Z"), localDay: "2026-08-26" },
    { takenAt: new Date("2026-08-28T21:00:00.000Z"), localDay: "2026-08-28" },
    { takenAt: new Date("2026-08-31T21:00:00.000Z"), localDay: "2026-08-31" },
    { takenAt: new Date("2026-09-02T21:00:00.000Z"), localDay: "2026-09-02" },
  ];

  const CLIENT_INPUT = {
    // A client could send ANY extra junk on protocolId's shape — only the id
    // itself is used to select the row; nothing else about the row comes
    // from the client.
    protocolId: "p1",
    k: 1,
    startDate: "2026-09-05",
    fingerprint: shiftFingerprint({
      protocolId: "p1",
      scheduleRule: HAPPY_ROW.scheduleRule,
      startDate: HAPPY_ROW.startDate,
      k: 1,
    }),
  };

  it("rebuilds `next` entirely server-side and forwards only k/startDate-derived facts to reviseProtocol", async () => {
    currentUser.mockResolvedValue({ id: "user-1" });
    protocolFindFirst.mockResolvedValue(HAPPY_ROW);
    doseLogFindMany.mockResolvedValue(DELIVERED_ROWS);
    reviseProtocol.mockResolvedValue({ ok: true, id: "successor-1" });

    const res = await applyShiftSuggestion(CLIENT_INPUT);

    // 2026-09-05 is already a Saturday — on the rotated TU/TH/SA pattern — so
    // the snapped start date equals the raw one here; see the dedicated
    // "start date snapping" block below for cases where they differ.
    expect(res).toEqual({ ok: true, newProtocolId: "successor-1", startDate: "2026-09-05" });
    expect(reviseProtocol).toHaveBeenCalledTimes(1);

    const call = reviseProtocol.mock.calls[0][0];
    expect(call.id).toBe("p1");
    expect(call.startDate).toBe("2026-09-05"); // passed through verbatim

    // The rotated rule: MWF + k=1 → TU/TH/SA, times untouched.
    expect(call.next.scheduleRule).toBe(rotatedRule(HAPPY_ROW.scheduleRule, 1));
    const parsed = JSON.parse(call.next.scheduleRule);
    expect(parsed[0].dayPattern.byDays).toEqual(["TU", "TH", "SA"]);
    expect(parsed[0].times).toEqual(["07:00"]);

    // `next` carries NO endDate at all — reviseProtocol carries the
    // predecessor's own row value byte-for-byte when this is undefined.
    expect(call.next.endDate).toBeUndefined();
    expect("endDate" in call.next).toBe(false);

    // Carry-forward: 5 delivered doses against targets [3,3,null] (ipw=3,
    // durationDays 7,7,null) lands mid-way through step 1 (dose 200), with
    // 4 calendar days already served in that phase — step shortened from 7
    // to 3 remaining days; step 2 (indefinite) copies through unchanged; both
    // reindexed to 0,1 and reported in stepIndex order despite the unsorted
    // input.
    expect(call.next.steps).toEqual([
      { dose: "200", doseInputUnit: "mcg", durationDays: "3" },
      { dose: "300", doseInputUnit: "mcg", durationDays: "" },
    ]);

    // Nothing else came from the client: `next` is built entirely from the
    // DB row (no cycle fields carried — reviseProtocol carries those from
    // the predecessor itself).
    expect(call.next).toEqual({
      peptideId: "pep-1",
      prescriptionId: "rx-1",
      name: "Retatrutide",
      source: "manual",
      scheduleType: "titration",
      scheduleRule: rotatedRule(HAPPY_ROW.scheduleRule, 1),
      rebaseMode: "fixed_anchor",
      adherenceWindowMin: "120",
      defaultSyringeId: "syr-1",
      targetDose: "300",
      doseInputUnit: "mcg",
      doseBasis: "per_injection",
      steps: [
        { dose: "200", doseInputUnit: "mcg", durationDays: "3" },
        { dose: "300", doseInputUnit: "mcg", durationDays: "" },
      ],
    });

    // An audit row for the shift itself, written after reviseProtocol
    // succeeds — entityId is the SUCCESSOR's id, not the predecessor's.
    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        entityType: "Protocol",
        entityId: "successor-1",
        field: "shift",
        newValue: "k=1; MO,WE,FR -> TU,TH,SA; start 2026-09-05; from p1",
      },
    });
  });

  // The reason `next.endDate` is gone at all: src/app/actions/cycle.ts
  // stores an endDate at LOCAL midnight. `new Date(d).toISOString().slice(0,10)`
  // on 2026-10-25T00:00+10:00 yields "2026-10-24" — a day EARLIER — and
  // reviseProtocol would then take its explicit-override branch and shorten the
  // successor's course by a day. Sending nothing is the only way the
  // predecessor's stored Date survives untouched.
  it("a LOCAL-midnight endDate is not re-derived, shortened or sent at all", async () => {
    const localMidnightEnd = new Date(2026, 9, 25); // Sun 2026-10-25, 00:00 Brisbane
    // Sanity: this is exactly the value the old date-only coercion mangled.
    expect(localMidnightEnd.toISOString().slice(0, 10)).toBe("2026-10-24");

    const row = { ...HAPPY_ROW, endDate: localMidnightEnd };
    currentUser.mockResolvedValue({ id: "user-1" });
    protocolFindFirst.mockResolvedValue(row);
    doseLogFindMany.mockResolvedValue(DELIVERED_ROWS);
    reviseProtocol.mockResolvedValue({ ok: true, id: "successor-tz" });

    const res = await applyShiftSuggestion(CLIENT_INPUT);

    expect(res.ok).toBe(true);
    expect(reviseProtocol).toHaveBeenCalledTimes(1);
    const call = reviseProtocol.mock.calls[0][0];
    expect(call.next.endDate).toBeUndefined();
    expect("endDate" in call.next).toBe(false);
  });

  // A logging failure must never undo a revision that already succeeded.
  it("an audit log write that throws still returns ok:true", async () => {
    currentUser.mockResolvedValue({ id: "user-1" });
    protocolFindFirst.mockResolvedValue(HAPPY_ROW);
    doseLogFindMany.mockResolvedValue(DELIVERED_ROWS);
    reviseProtocol.mockResolvedValue({ ok: true, id: "successor-1" });
    auditLogCreate.mockRejectedValueOnce(new Error("audit table locked"));

    const res = await applyShiftSuggestion(CLIENT_INPUT);

    expect(res).toEqual({ ok: true, newProtocolId: "successor-1", startDate: "2026-09-05" });
  });
});

describe("applyShiftSuggestion — reviseProtocol result mapping", () => {
  const ROW = {
    id: "p1",
    userId: "user-1",
    peptideId: "pep-1",
    prescriptionId: null,
    stackId: null,
    name: "Retatrutide",
    source: "manual",
    scheduleType: "titration",
    scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]),
    rebaseMode: "fixed_anchor",
    adherenceWindowMin: 120,
    defaultSyringeId: null,
    targetDose: "300",
    doseInputUnit: "mcg",
    doseBasis: "per_injection",
    startDate: U("2026-01-05"),
    endDate: U("2026-12-31"),
    status: "active",
    cycleOnWeeks: null,
    cycleOffWeeks: null,
    cycleAnchor: null,
    shiftPinned: false,
    steps: [],
    peptide: { name: "Retatrutide" },
  };

  const request = () =>
    applyShiftSuggestion({
      protocolId: "p1",
      k: 1,
      startDate: "2026-09-05",
      fingerprint: shiftFingerprint({
        protocolId: ROW.id,
        scheduleRule: ROW.scheduleRule,
        startDate: ROW.startDate,
        k: 1,
      }),
    });

  beforeEach(() => {
    currentUser.mockResolvedValue({ id: "user-1" });
    protocolFindFirst.mockResolvedValue(ROW);
    doseLogFindMany.mockResolvedValue([]);
  });

  it("reviseProtocol's race message → code:race", async () => {
    reviseProtocol.mockResolvedValue({
      ok: false,
      error: "This protocol was already revised or closed. Refresh and try again.",
    });
    const res = await request();
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("race");
  });

  it("any other reviseProtocol error → code:failed, text passed through", async () => {
    reviseProtocol.mockResolvedValue({ ok: false, error: "Could not revise the protocol." });
    const res = await request();
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("failed");
    expect(!res.ok && res.error).toBe("Could not revise the protocol.");
  });

  it("a thrown error (e.g. reviseProtocol rejects) → code:failed", async () => {
    reviseProtocol.mockRejectedValue(new Error("boom"));
    const res = await request();
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("failed");
  });
});

// An edited start date used to be forwarded to
// reviseProtocol VERBATIM even when that weekday isn't in the rotated
// pattern. Now it is snapped through shift-transition.ts's
// `snapStartToPattern` first — these prove what `reviseProtocol` actually
// receives for each of the snap's floors (pattern day, today-logged,
// protocol's own startDate).
describe("applyShiftSuggestion — start date snapping", () => {
  const ROW = {
    id: "p1",
    userId: "user-1",
    peptideId: "pep-1",
    prescriptionId: null,
    stackId: null,
    name: "Retatrutide",
    source: "manual",
    scheduleType: "titration",
    scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]),
    rebaseMode: "fixed_anchor",
    adherenceWindowMin: 120,
    defaultSyringeId: null,
    targetDose: "300",
    doseInputUnit: "mcg",
    doseBasis: "per_injection",
    startDate: U("2026-01-05"),
    endDate: U("2026-12-31"),
    status: "active",
    cycleOnWeeks: null,
    cycleOffWeeks: null,
    cycleAnchor: null,
    shiftPinned: false,
    steps: [],
    peptide: { name: "Retatrutide" },
  };

  async function applyWith(
    k: number,
    startDate: string,
    rowOverride: Partial<typeof ROW> = {},
    deliveredDayKeys: string[] = [],
  ) {
    const row = { ...ROW, ...rowOverride };
    currentUser.mockResolvedValue({ id: "user-1" });
    protocolFindFirst.mockResolvedValue(row);
    doseLogFindMany.mockResolvedValue(
      deliveredDayKeys.map((localDay) => ({ takenAt: new Date(`${localDay}T00:00:00.000Z`), localDay })),
    );
    reviseProtocol.mockResolvedValue({ ok: true, id: "successor-x" });
    const fingerprint = shiftFingerprint({
      protocolId: row.id,
      scheduleRule: row.scheduleRule,
      startDate: row.startDate,
      k,
    });
    return applyShiftSuggestion({ protocolId: row.id, k, startDate, fingerprint });
  }

  it("a Monday sent for a Tue/Thu/Sat successor (MWF, k=1) → reviseProtocol gets the following Tuesday", async () => {
    const res = await applyWith(1, "2026-09-07"); // Mon
    expect(res).toEqual({ ok: true, newProtocolId: "successor-x", startDate: "2026-09-08" });
    expect(reviseProtocol.mock.calls[0][0].startDate).toBe("2026-09-08"); // Tue
  });

  it("a Saturday already on the rotated pattern → unchanged", async () => {
    const res = await applyWith(1, "2026-09-05"); // Sat, already TU/TH/SA
    expect(res).toEqual({ ok: true, newProtocolId: "successor-x", startDate: "2026-09-05" });
  });

  it("today sent with today's dose already logged → tomorrow or later, never today", async () => {
    // k=2 rotates MWF -> WE/FR/SU: tomorrow (Sat) is not on-pattern, so the
    // snap must walk past it to Sunday — proving "or later", not just +1 day.
    const res = await applyWith(2, "2026-09-04", {}, ["2026-09-04"]);
    expect(res.ok).toBe(true);
    expect(res.ok && res.startDate).toBe("2026-09-06"); // Sun
    expect(res.ok && res.startDate).not.toBe("2026-09-04");
  });

  it("a chosen date at/before the protocol's own startDate → the first pattern match strictly after it", async () => {
    const res = await applyWith(1, "2026-09-06", { startDate: U("2026-09-10") }); // Sun <= Thu 10 Sep
    expect(res.ok).toBe(true);
    // First TU/TH/SA day strictly after 2026-09-10: 09-11 is a Friday (not in
    // pattern), so 09-12 (Sat) is the actual first match.
    expect(res.ok && res.startDate).toBe("2026-09-12");
  });
});

// The raw start-date bound is today + 14 and is checked before the row is
// even loaded; the pattern snap runs AFTER it and may push the start up to 6
// days further out (the widest gap in a weekly pattern), which is why the cap
// below is today + 20. Without it, a protocol whose own startDate is months
// away pushed the snapped start arbitrarily far out — snapStartToPattern's
// "strictly after the predecessor's start" floor has no upper bound of its own
// — and reviseProtocol happily created a successor starting then.
describe("applyShiftSuggestion — the SNAPPED start is capped as well as the raw one", () => {
  const ROW = {
    id: "p1",
    userId: "user-1",
    peptideId: "pep-1",
    prescriptionId: null,
    stackId: null,
    name: "Retatrutide",
    source: "manual",
    scheduleType: "fixed_times",
    scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]),
    rebaseMode: "fixed_anchor",
    adherenceWindowMin: 120,
    defaultSyringeId: null,
    targetDose: "300",
    doseInputUnit: "mcg",
    doseBasis: "per_injection",
    // 60 days out from the viewer's Fri 2026-09-04.
    startDate: U("2026-11-03"),
    endDate: null,
    status: "active",
    cycleOnWeeks: null,
    cycleOffWeeks: null,
    cycleAnchor: null,
    shiftPinned: false,
    steps: [],
    peptide: { name: "Retatrutide" },
  };

  it("a protocol whose own startDate is 60 days out → code:invalid, reviseProtocol not called", async () => {
    currentUser.mockResolvedValue({ id: "user-1" });
    protocolFindFirst.mockResolvedValue(ROW);
    doseLogFindMany.mockResolvedValue([]);
    reviseProtocol.mockResolvedValue({ ok: true, id: "should-not-happen" });
    const fingerprint = shiftFingerprint({
      protocolId: ROW.id,
      scheduleRule: ROW.scheduleRule,
      startDate: ROW.startDate,
      k: 1,
    });

    // The RAW date is inside the 14-day window and passes the early check; the
    // snap then walks past 2026-11-03 to the first TU/TH/SA after it.
    const res = await applyShiftSuggestion({
      protocolId: ROW.id,
      k: 1,
      startDate: "2026-09-05",
      fingerprint,
    });

    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("invalid");
    expect(!res.ok && res.error).toBe("The first day on the new pattern would be more than 20 days out. Pick an earlier start date.");
    expect(reviseProtocol).not.toHaveBeenCalled();
  });

  // The cap does not over-block: the "start date at/before the protocol's own
  // startDate" case above snaps to 2026-09-12 (today + 8) and proceeds
  // normally, which is the same code path one branch earlier.
});

// applyShiftPlan applies a combined plan's moves one at a time through
// the SAME applyOne core applyShiftSuggestion uses (refactor). These tests
// cover the batch-specific behaviour (up-front validation of every move,
// sequential apply, stop-at-first-failure); applyOne's own load/fingerprint/
// eligibility/rebuild logic is already covered exhaustively above, through
// applyShiftSuggestion.
describe("applyShiftPlan — malformed input, nothing applied", () => {
  const validMove = (protocolId: string, overrides: Partial<typeof VALID_INPUT> = {}) => ({
    ...VALID_INPUT,
    protocolId,
    ...overrides,
  });

  const shapes: [string, unknown][] = [
    ["input is undefined", undefined],
    ["input is null", null],
    ["input is an array", []],
    ["moves is not an array", { moves: "nope" }],
    ["moves is empty", { moves: [] }],
    ["moves has 11 entries (max is 10)", { moves: Array.from({ length: 11 }, (_, i) => validMove(`p${i}`)) }],
    ["duplicate protocolIds", { moves: [validMove("p1"), validMove("p1")] }],
    [
      "one malformed move among otherwise-valid ones (k out of range)",
      { moves: [validMove("p1"), { ...validMove("p2"), k: 99 }, validMove("p3")] },
    ],
  ];

  it.each(shapes)("%s → ok:false, appliedCount:0, code:invalid, no reviseProtocol call", async (_label, value) => {
    const res = await applyShiftPlan(value as never);
    expect(res.ok).toBe(false);
    expect(res.appliedCount).toBe(0);
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results.every((r) => !r.ok && r.code === "invalid")).toBe(true);
    expect(reviseProtocol).not.toHaveBeenCalled();
    expect(protocolFindFirst).not.toHaveBeenCalled();
  });
});

describe("applyShiftPlan — not signed in", () => {
  it("null user → code:auth, appliedCount 0, no DB read and no revalidate", async () => {
    currentUser.mockResolvedValue(null);
    const move = {
      protocolId: "p1",
      k: 1,
      startDate: "2026-09-05",
      fingerprint: VALID_FINGERPRINT,
    };

    const res = await applyShiftPlan({ moves: [move, { ...move, protocolId: "p2" }] });

    expect(res).toEqual({
      ok: false,
      appliedCount: 0,
      results: [{ protocolId: "", ok: false, code: "auth", error: "Not signed in." }],
    });
    expect(protocolFindFirst).not.toHaveBeenCalled();
    expect(reviseProtocol).not.toHaveBeenCalled();
    // Pins the early return: an unauthenticated caller does no cache work either.
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("applyShiftPlan — sequential apply through applyOne", () => {
  const rowFor = (id: string) => ({
    id,
    userId: "user-1",
    peptideId: `pep-${id}`,
    prescriptionId: null,
    stackId: null,
    name: id,
    source: "manual",
    scheduleType: "fixed_times",
    scheduleRule: weeklyRule(["MO", "WE", "FR"], ["07:00"]),
    rebaseMode: "fixed_anchor",
    adherenceWindowMin: 120,
    defaultSyringeId: null,
    targetDose: "300",
    doseInputUnit: "mcg",
    doseBasis: "per_injection",
    startDate: U("2026-01-05"),
    endDate: U("2026-12-31"),
    status: "active",
    cycleOnWeeks: null,
    cycleOffWeeks: null,
    cycleAnchor: null,
    shiftPinned: false,
    steps: [] as never[],
    peptide: { name: id },
  });

  const ROWS: Record<string, ReturnType<typeof rowFor>> = {
    p1: rowFor("p1"),
    p2: rowFor("p2"),
    p3: rowFor("p3"),
  };

  // Sat 2026-09-05 is already on the rotated (k=1) TU/TH/SA pattern for an
  // MWF protocol — same fixture shape as the "happy path" block above — so
  // the snap is a no-op and reviseProtocol gets this date back unchanged.
  const moveFor = (id: string) => ({
    protocolId: id,
    k: 1,
    startDate: "2026-09-05",
    fingerprint: shiftFingerprint({
      protocolId: id,
      scheduleRule: ROWS[id].scheduleRule,
      startDate: ROWS[id].startDate,
      k: 1,
    }),
  });

  beforeEach(() => {
    currentUser.mockResolvedValue({ id: "user-1" });
    protocolFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ROWS[where.id] ?? null);
    doseLogFindMany.mockResolvedValue([]);
  });

  it("happy path: 3 moves applied in order, reviseProtocol called 3 times with the snapped startDates", async () => {
    reviseProtocol.mockImplementation(async ({ id }: { id: string }) => ({ ok: true, id: `successor-${id}` }));

    const res = await applyShiftPlan({ moves: [moveFor("p1"), moveFor("p2"), moveFor("p3")] });

    expect(res.ok).toBe(true);
    expect(res.appliedCount).toBe(3);
    expect(res.results).toEqual([
      { protocolId: "p1", ok: true, newProtocolId: "successor-p1", startDate: "2026-09-05" },
      { protocolId: "p2", ok: true, newProtocolId: "successor-p2", startDate: "2026-09-05" },
      { protocolId: "p3", ok: true, newProtocolId: "successor-p3", startDate: "2026-09-05" },
    ]);

    expect(reviseProtocol).toHaveBeenCalledTimes(3);
    expect(reviseProtocol.mock.calls[0][0].id).toBe("p1");
    expect(reviseProtocol.mock.calls[0][0].startDate).toBe("2026-09-05");
    expect(reviseProtocol.mock.calls[1][0].id).toBe("p2");
    expect(reviseProtocol.mock.calls[1][0].startDate).toBe("2026-09-05");
    expect(reviseProtocol.mock.calls[2][0].id).toBe("p3");
    expect(reviseProtocol.mock.calls[2][0].startDate).toBe("2026-09-05");

    expect(revalidatePath).toHaveBeenCalledWith("/protocols");
    expect(revalidatePath).toHaveBeenCalledWith("/today");
  });

  it("stops at the first failure: second move races, third is never attempted", async () => {
    reviseProtocol.mockImplementation(async ({ id }: { id: string }) => {
      if (id === "p2") {
        return {
          ok: false,
          error: "This protocol was already revised or closed. Refresh and try again.",
        };
      }
      return { ok: true, id: `successor-${id}` };
    });

    const res = await applyShiftPlan({ moves: [moveFor("p1"), moveFor("p2"), moveFor("p3")] });

    expect(res.ok).toBe(false);
    expect(res.appliedCount).toBe(1);
    expect(res.results).toEqual([
      { protocolId: "p1", ok: true, newProtocolId: "successor-p1", startDate: "2026-09-05" },
      {
        protocolId: "p2",
        ok: false,
        code: "race",
        error: "This protocol was already revised or closed. Refresh and try again.",
      },
    ]);
    expect(reviseProtocol).toHaveBeenCalledTimes(2);
    // p3 is never attempted — not loaded, not revised, no result entry at all.
    expect(protocolFindFirst).toHaveBeenCalledTimes(2);
  });
});

describe("pinShiftSuggestion", () => {
  it("updateMany is scoped by both id and userId; success revalidates /protocols and /today", async () => {
    currentUser.mockResolvedValue({ id: "user-1" });
    protocolUpdateMany.mockResolvedValue({ count: 1 });

    const res = await pinShiftSuggestion({ protocolId: "p1", pinned: true });

    expect(res).toEqual({ ok: true });
    expect(protocolUpdateMany).toHaveBeenCalledWith({
      where: { id: "p1", userId: "user-1" },
      data: { shiftPinned: true },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/protocols");
    expect(revalidatePath).toHaveBeenCalledWith("/today");
  });

  it("count 0 (not found / not owned) → error, no revalidate", async () => {
    currentUser.mockResolvedValue({ id: "user-1" });
    protocolUpdateMany.mockResolvedValue({ count: 0 });

    const res = await pinShiftSuggestion({ protocolId: "p1", pinned: false });

    expect(res.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("not signed in → error, no DB call", async () => {
    currentUser.mockResolvedValue(null);
    const res = await pinShiftSuggestion({ protocolId: "p1", pinned: true });
    expect(res.ok).toBe(false);
    expect(protocolUpdateMany).not.toHaveBeenCalled();
  });

  // Same malformed-shape 500, and pin's protocolId
  // had no length cap (apply's does).
  describe("malformed input shape, not just malformed fields", () => {
    const shapes: [string, unknown][] = [
      ["undefined", undefined],
      ["null", null],
      ["an array", []],
      ["a plain string", "x"],
    ];

    it.each(shapes)("input is %s → error, no DB call", async (_label, value) => {
      const res = await pinShiftSuggestion(value as never);
      expect(res.ok).toBe(false);
      expect(!res.ok && res.error).toBe("Invalid request.");
      expect(currentUser).not.toHaveBeenCalled();
      expect(protocolUpdateMany).not.toHaveBeenCalled();
    });

    it("protocolId longer than 64 chars → error, no DB call", async () => {
      const res = await pinShiftSuggestion({ protocolId: "p".repeat(65), pinned: true });
      expect(res.ok).toBe(false);
      expect(protocolUpdateMany).not.toHaveBeenCalled();
    });
  });
});
