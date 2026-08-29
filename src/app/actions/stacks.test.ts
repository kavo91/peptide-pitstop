import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  stackFindFirst,
  syringeFindFirst,
  doseLogCount,
  preparationFindFirst,
  currentUser,
  revalidatePath,
  getTodayDoses,
  logDose,
  transaction,
  txStackCreate,
  txPeptideFindMany,
  txPeptideCreate,
  txVialCreate,
  txPreparationCreate,
  txProtocolCreate,
  runPlannedDoseGeneration,
  protocolFindMany,
  protocolFindFirst,
  protocolUpdateMany,
  userFindUnique,
} = vi.hoisted(() => ({
  stackFindFirst: vi.fn(),
  syringeFindFirst: vi.fn(),
  doseLogCount: vi.fn(),
  preparationFindFirst: vi.fn(),
  currentUser: vi.fn(),
  revalidatePath: vi.fn(),
  getTodayDoses: vi.fn(),
  logDose: vi.fn(),
  transaction: vi.fn(),
  txStackCreate: vi.fn(),
  txPeptideFindMany: vi.fn(),
  txPeptideCreate: vi.fn(),
  txVialCreate: vi.fn(),
  txPreparationCreate: vi.fn(),
  txProtocolCreate: vi.fn(),
  runPlannedDoseGeneration: vi.fn(),
  protocolFindMany: vi.fn(),
  protocolFindFirst: vi.fn(),
  protocolUpdateMany: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    stack: { findFirst: stackFindFirst },
    syringe: { findFirst: syringeFindFirst },
    doseLog: { count: doseLogCount },
    preparation: { findFirst: preparationFindFirst },
    protocol: { findMany: protocolFindMany, findFirst: protocolFindFirst, updateMany: protocolUpdateMany },
    user: { findUnique: userFindUnique },
    $transaction: transaction,
  },
}));
vi.mock("@/lib/auth/owner", () => ({ getCurrentUser: currentUser }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/today", () => ({ getTodayDoses }));
vi.mock("./doses", () => ({ logDose }));
vi.mock("@/lib/planned/run", () => ({ runPlannedDoseGeneration }));

import { createStack, logStack, updateStackSchedule } from "./stacks";
import { trackingDayOf } from "@/lib/local-day";

// The stamp must be TODAY's viewer day — resolveTrackingDayStamp rejects a
// stale stamp (this test suite rotted at the first midnight with a literal).
const TODAY = trackingDayOf(new Date());

// One titrating and one flat component under a single stack. The resolver
// authority (getTodayDoses) is the ONLY legitimate source for the logged dose
// (spec §6) — raw Protocol.targetDose must never reach logDose once a ladder
// can exist on a stack component.
const USER = { id: "u1" };
const STACK = {
  id: "s1",
  userId: "u1",
  protocols: [
    { id: "p-titrating", peptideId: "pep1", vialId: "v1", targetDose: { toString: () => "0.2" } },
    { id: "p-flat", peptideId: "pep2", vialId: "v2", targetDose: { toString: () => "0.3" } },
  ],
};

function dueItem(protocolId: string, doseValue: string, doseUnit = "ml") {
  return { protocolId, doseValue, doseUnit };
}

const TX = {
  stack: { create: txStackCreate },
  peptide: { findMany: txPeptideFindMany, create: txPeptideCreate },
  vial: { create: txVialCreate },
  preparation: { create: txPreparationCreate },
  protocol: { create: txProtocolCreate },
};

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.mockResolvedValue(USER);
  stackFindFirst.mockResolvedValue(STACK);
  syringeFindFirst.mockResolvedValue({ id: "syr1" });
  doseLogCount.mockResolvedValue(0);
  preparationFindFirst.mockResolvedValue({ id: "prep1" });
  userFindUnique.mockResolvedValue({ defaultSyringeId: null });
  logDose.mockResolvedValue({ ok: true });
  transaction.mockImplementation(async (fn: (tx: typeof TX) => Promise<unknown>) => fn(TX));
  txStackCreate.mockResolvedValue({ id: "s-new" });
  txPeptideFindMany.mockResolvedValue([]);
  let pepN = 0;
  txPeptideCreate.mockImplementation(async () => ({ id: `pep-${++pepN}` }));
  let vialN = 0;
  txVialCreate.mockImplementation(async () => ({ id: `vial-${++vialN}` }));
  txPreparationCreate.mockResolvedValue({ id: "prep-new" });
  txProtocolCreate.mockResolvedValue({ id: "proto-new" });
  runPlannedDoseGeneration.mockResolvedValue(undefined);
});

describe("logStack dose sourcing (spec §6)", () => {
  it("logs the resolver's per-slot dose for a titrating component, not targetDose", async () => {
    getTodayDoses.mockResolvedValue([
      dueItem("p-titrating", "300", "mcg"), // active step says 300 mcg
      dueItem("p-flat", "0.3", "ml"),
    ]);
    const res = await logStack("s1", { localDay: TODAY, tz: "Australia/Brisbane" });
    expect(res.ok).toBe(true);
    expect(res.ok && res.logged).toBe(2);
    const calls = logDose.mock.calls.map(([arg]) => arg);
    const titr = calls.find((c) => c.protocolId === "p-titrating");
    expect(titr.doseValue).toBe("300");
    expect(titr.doseUnit).toBe("mcg");
    // the raw 0.2 ml targetDose must not appear anywhere in the titrating call
    expect(titr.doseValue).not.toBe("0.2");
  });

  it("skips a component whose dose is unresolvable ('' fail-safe) and surfaces the reason", async () => {
    getTodayDoses.mockResolvedValue([
      dueItem("p-titrating", "", "mcg"), // unresolved frequency → fail-safe blank
      dueItem("p-flat", "0.3", "ml"),
    ]);
    const res = await logStack("s1", { localDay: TODAY, tz: "Australia/Brisbane" });
    expect(res.ok).toBe(true);
    expect(res.ok && res.logged).toBe(1); // only the flat component
    const calls = logDose.mock.calls.map(([arg]) => arg);
    expect(calls.some((c) => c.protocolId === "p-titrating")).toBe(false);
    const flat = calls.find((c) => c.protocolId === "p-flat");
    expect(flat.doseValue).toBe("0.3");
  });

  it("keeps the fixed-dose path byte-identical for no-steps components", async () => {
    getTodayDoses.mockResolvedValue([
      dueItem("p-titrating", "0.2", "ml"), // no ladder: resolver falls back to targetDose
      dueItem("p-flat", "0.3", "ml"),
    ]);
    const res = await logStack("s1", { localDay: TODAY, tz: "Australia/Brisbane" });
    expect(res.ok && res.logged).toBe(2);
    const calls = logDose.mock.calls.map(([arg]) => arg);
    expect(calls.find((c) => c.protocolId === "p-titrating").doseValue).toBe("0.2");
    expect(calls.find((c) => c.protocolId === "p-titrating").doseUnit).toBe("ml");
    // idempotency key + stamp contract unchanged
    expect(calls[0].clientUuid).toBe(`stack-s1-p-titrating-${TODAY}`);
    expect(calls[0].localDay).toBe(TODAY);
    expect(calls[0].tz).toBe("Australia/Brisbane");
  });
});

const COMPONENT = {
  peptideName: "CJC-1295 no-DAC",
  concentrationMcgPerMl: "5000",
  vialSizeMl: "2",
  qty: "1",
  doseMl: "0.04",
};
const RAMP = { startDose: "200", targetDose: "400", increment: "100", weeksPerStep: "2", doseInputUnit: "mcg" };

describe("createStack titration ramps", () => {
  it("creates ProtocolStep rows from the ramp in the same transaction, contiguous with a null final step", async () => {
    const res = await createStack({
      name: "GH stack",
      startDateISO: "2026-08-29",
      components: [{ ...COMPONENT, ramp: RAMP }],
    });
    expect(res.ok).toBe(true);
    const data = txProtocolCreate.mock.calls[0][0].data;
    expect(data.startDate).toEqual(new Date("2026-08-29"));
    const steps = data.steps.create;
    expect(steps.map((s: { stepIndex: number }) => s.stepIndex)).toEqual([0, 1, 2]);
    expect(steps.map((s: { dose: string }) => s.dose)).toEqual(["200", "300", "400"]);
    expect(steps.map((s: { durationDays: number | null }) => s.durationDays)).toEqual([14, 14, null]);
    expect(steps.every((s: { doseInputUnit: string }) => s.doseInputUnit === "mcg")).toBe(true);
    expect(runPlannedDoseGeneration).toHaveBeenCalledWith("u1");
  });

  it("refuses a ramp without a stack start date (an inert ladder must not be creatable)", async () => {
    const res = await createStack({ name: "GH stack", components: [{ ...COMPONENT, ramp: RAMP }] });
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.error).toMatch(/start date/i);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("keeps the no-ramp path byte-identical (no steps, no startDate)", async () => {
    const res = await createStack({ name: "Flat stack", components: [COMPONENT] });
    expect(res.ok).toBe(true);
    const data = txProtocolCreate.mock.calls[0][0].data;
    expect(data.steps).toBeUndefined();
    expect(data.startDate).toBeUndefined();
    expect(runPlannedDoseGeneration).not.toHaveBeenCalled();
  });

  it("refuses an invalid ramp pre-transaction with the component named", async () => {
    const res = await createStack({
      name: "GH stack",
      startDateISO: "2026-08-29",
      components: [{ ...COMPONENT, ramp: { ...RAMP, increment: "0" } }],
    });
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.error).toMatch(/CJC-1295 no-DAC/);
    expect(res.ok ? "" : res.error).toMatch(/increment/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("coerces an unknown ramp unit to mcg (write-site whitelist convention)", async () => {
    const res = await createStack({
      name: "GH stack",
      startDateISO: "2026-08-29",
      components: [{ ...COMPONENT, ramp: { ...RAMP, doseInputUnit: "bananas" } }],
    });
    expect(res.ok).toBe(true);
    const steps = txProtocolCreate.mock.calls[0][0].data.steps.create;
    expect(steps.every((s: { doseInputUnit: string }) => s.doseInputUnit === "mcg")).toBe(true);
  });
});

const DAILY = JSON.stringify([{ dayPattern: { kind: "daily" }, times: [] }]);
const WEEKDAYS = JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "TU", "WE", "TH", "FR"] }, times: [] }]);

function comp(steps: number, doses: number, rule = DAILY) {
  return { scheduleRule: rule, startDate: new Date("2026-08-24T00:00:00Z"), _count: { steps, doseLogs: doses } };
}

describe("updateStackSchedule material-change guard", () => {
  beforeEach(() => {
    stackFindFirst.mockResolvedValue({ id: "s1", userId: "u1" });
    protocolUpdateMany.mockResolvedValue({ count: 2 });
    runPlannedDoseGeneration.mockResolvedValue(undefined);
  });

  it("refuses a rule change while a titrating component has delivered doses", async () => {
    protocolFindMany.mockResolvedValue([comp(3, 5), comp(0, 5)]);
    const res = await updateStackSchedule("s1", WEEKDAYS, "2026-08-24");
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.error).toMatch(/revis/i);
    expect(protocolUpdateMany).not.toHaveBeenCalled();
  });

  it("allows the change when no titrating component has delivered doses yet", async () => {
    protocolFindMany.mockResolvedValue([comp(3, 0), comp(0, 7)]);
    const res = await updateStackSchedule("s1", WEEKDAYS, "2026-08-24");
    expect(res.ok).toBe(true);
    expect(protocolUpdateMany).toHaveBeenCalled();
  });

  it("allows a rewrite on a purely fixed-dose stack with doses (today's behaviour)", async () => {
    protocolFindMany.mockResolvedValue([comp(0, 9), comp(0, 9)]);
    const res = await updateStackSchedule("s1", WEEKDAYS, "2026-08-24");
    expect(res.ok).toBe(true);
    expect(protocolUpdateMany).toHaveBeenCalled();
  });

  it("allows an ECHOED unchanged schedule even on a live titrating stack (no material change)", async () => {
    protocolFindMany.mockResolvedValue([comp(3, 5, DAILY)]);
    const res = await updateStackSchedule("s1", DAILY, "2026-08-24");
    expect(res.ok).toBe(true);
    expect(protocolUpdateMany).toHaveBeenCalled();
  });
});

describe("logStack course-lineage dedup + units guard (review fixes)", () => {
  const REVISED_STACK = {
    id: "s1",
    userId: "u1",
    protocols: [
      { id: "p-a", courseId: null, status: "active", startDate: new Date("2026-08-01"), peptideId: "pepA", vialId: "vA", targetDose: { toString: () => "0.2" } },
      { id: "p-b-old", courseId: null, status: "completed", startDate: new Date("2026-08-01"), peptideId: "pepB", vialId: "vB", targetDose: { toString: () => "0.3" } },
      { id: "p-b-new", courseId: "p-b-old", status: "active", startDate: new Date("2026-08-28"), peptideId: "pepB", vialId: "vB", targetDose: { toString: () => "0.3" } },
    ],
  };

  it("does not double-log a peptide on revision day — dedup spans the course lineage", async () => {
    stackFindFirst.mockResolvedValue(REVISED_STACK);
    getTodayDoses.mockResolvedValue([dueItem("p-a", "0.2"), dueItem("p-b-new", "0.3")]);
    // predecessor p-b-old already holds today's dose: any count over a group
    // containing it returns 1
    doseLogCount.mockImplementation(async ({ where }: { where: { protocolId: { in: string[] } } }) =>
      where.protocolId.in.includes("p-b-old") ? 1 : 0,
    );
    const res = await logStack("s1", { localDay: TODAY, tz: "Australia/Brisbane" });
    expect(res.ok).toBe(true);
    expect(res.ok && res.logged).toBe(1); // only p-a — pepB was taken this morning
    const calls = logDose.mock.calls.map(([a]) => a);
    expect(calls.some((c) => c.protocolId === "p-b-new" || c.protocolId === "p-b-old")).toBe(false);
  });

  it("never logs through the completed predecessor even if it appears due", async () => {
    stackFindFirst.mockResolvedValue(REVISED_STACK);
    getTodayDoses.mockResolvedValue([dueItem("p-b-old", "0.3"), dueItem("p-b-new", "0.3")]);
    doseLogCount.mockResolvedValue(0);
    await logStack("s1", { localDay: TODAY, tz: "Australia/Brisbane" });
    const calls = logDose.mock.calls.map(([a]) => a);
    expect(calls.map((c) => c.protocolId)).toEqual(["p-b-new"]); // tip only
  });

  it("skips a syringe-relative 'units' dose and says so even when others logged", async () => {
    getTodayDoses.mockResolvedValue([dueItem("p-titrating", "20", "units"), dueItem("p-flat", "0.3", "ml")]);
    const res = await logStack("s1", { localDay: TODAY, tz: "Australia/Brisbane" });
    expect(res.ok && res.logged).toBe(1);
    expect(res.ok && res.error).toMatch(/units/i);
    expect(logDose.mock.calls.map(([a]) => a).some((c) => c.doseUnit === "units")).toBe(false);
  });
});

describe("createStack refuses ambiguous units ramps", () => {
  it("names the component and does not open a transaction", async () => {
    const res = await createStack({
      name: "GH stack",
      startDateISO: "2026-08-29",
      components: [{ ...COMPONENT, ramp: { ...RAMP, doseInputUnit: "units" } }],
    });
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.error).toMatch(/units ladders aren't supported/);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("updateStackSchedule lineage + start-date protections (review fixes)", () => {
  function tipComp(id: string, courseId: string | null, status: string, steps: number, doses: number, rule = DAILY) {
    return { id, courseId, status, scheduleRule: rule, startDate: new Date("2026-08-24T00:00:00Z"), _count: { steps, doseLogs: doses } };
  }
  beforeEach(() => {
    stackFindFirst.mockResolvedValue({ id: "s1", userId: "u1" });
    protocolUpdateMany.mockResolvedValue({ count: 2 });
    runPlannedDoseGeneration.mockResolvedValue(undefined);
  });

  it("a revised-away ladder (completed predecessor with steps+doses) no longer locks the schedule", async () => {
    protocolFindMany.mockResolvedValue([
      tipComp("b-old", null, "completed", 3, 20), // frozen history
      tipComp("b-new", "b-old", "active", 0, 2), // live successor, no steps
    ]);
    const res = await updateStackSchedule("s1", WEEKDAYS, "2026-08-24");
    expect(res.ok).toBe(true);
    // and the write goes to the TIP only — never the predecessor
    const where = protocolUpdateMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ in: ["b-new"] });
  });

  it("refuses clearing the start date while a tip carries a ladder (inert-ladder downgrade)", async () => {
    protocolFindMany.mockResolvedValue([tipComp("a", null, "active", 3, 0)]);
    const res = await updateStackSchedule("s1", DAILY, "");
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.error).toMatch(/start date is required/i);
    expect(protocolUpdateMany).not.toHaveBeenCalled();
  });
});

describe("logStack syringe preference", () => {
  it("uses the user's default device when one is set, not the alphabetical first", async () => {
    getTodayDoses.mockResolvedValue([dueItem("p-flat", "0.3", "ml")]);
    userFindUnique.mockResolvedValue({ defaultSyringeId: "syr-pref" });
    syringeFindFirst.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id === "syr-pref" ? { id: "syr-pref" } : { id: "syr-alpha" },
    );
    await logStack("s1", { localDay: TODAY, tz: "Australia/Brisbane" });
    expect(logDose.mock.calls[0][0].syringeId).toBe("syr-pref");
  });

  it("falls back to the alphabetical own-or-shared pick without a default (old behaviour)", async () => {
    getTodayDoses.mockResolvedValue([dueItem("p-flat", "0.3", "ml")]);
    userFindUnique.mockResolvedValue({ defaultSyringeId: null });
    syringeFindFirst.mockResolvedValue({ id: "syr-alpha" });
    await logStack("s1", { localDay: TODAY, tz: "Australia/Brisbane" });
    expect(logDose.mock.calls[0][0].syringeId).toBe("syr-alpha");
  });
});
