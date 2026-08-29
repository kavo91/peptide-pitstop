import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  protocolFindFirst,
  protocolUpdateMany,
  protocolCount,
  protocolFindMany,
  protocolCreate,
  protocolStepCreateMany,
  transaction,
  currentUser,
  revalidatePath,
  assertPeptideUsable,
  assertPrescriptionOwned,
  assertSyringeUsable,
  assertPrescriptionCompatible,
  runPlannedDoseGeneration,
  normaliseScheduleRule,
  doseLogFindFirst,
  auditLogCreate,
} = vi.hoisted(() => ({
  protocolFindFirst: vi.fn(),
  protocolUpdateMany: vi.fn(),
  protocolCount: vi.fn(),
  protocolFindMany: vi.fn(),
  protocolCreate: vi.fn(),
  protocolStepCreateMany: vi.fn(),
  transaction: vi.fn(),
  currentUser: vi.fn(),
  revalidatePath: vi.fn(),
  assertPeptideUsable: vi.fn(),
  assertPrescriptionOwned: vi.fn(),
  assertSyringeUsable: vi.fn(),
  assertPrescriptionCompatible: vi.fn(),
  runPlannedDoseGeneration: vi.fn(),
  normaliseScheduleRule: vi.fn(),
  doseLogFindFirst: vi.fn(),
  auditLogCreate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    protocol: {
      findFirst: protocolFindFirst,
      updateMany: protocolUpdateMany,
      count: protocolCount,
      findMany: protocolFindMany,
      create: protocolCreate,
    },
    protocolStep: {
      createMany: protocolStepCreateMany,
    },
    doseLog: { findFirst: doseLogFindFirst },
    auditLog: { create: auditLogCreate },
    $transaction: transaction,
  },
}));

vi.mock("@/lib/auth/owner", () => ({
  getCurrentUser: currentUser,
}));

vi.mock("next/cache", () => ({
  revalidatePath,
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/ownership", () => ({
  assertPeptideUsable,
  assertPrescriptionOwned,
  assertSyringeUsable,
  assertPrescriptionCompatible,
}));

vi.mock("@/lib/planned/run", () => ({
  runPlannedDoseGeneration,
}));

vi.mock("@/lib/schedule/normalise", () => ({
  normaliseScheduleRule,
}));

import {
  pauseProtocol,
  resumeProtocol,
  saveProtocol,
  addProtocolStep,
  addProtocolSteps,
  updateProtocolStep,
  updateProtocol,
  reviseProtocol,
} from "./protocols";
import { NEGATIVE_DURATION_ERROR } from "@/lib/titration/step-duration";

beforeEach(() => {
  protocolFindFirst.mockReset();
  protocolUpdateMany.mockReset();
  protocolCount.mockReset();
  protocolFindMany.mockReset();
  protocolCreate.mockReset();
  protocolStepCreateMany.mockReset();
  transaction.mockReset();
  currentUser.mockReset();
  revalidatePath.mockReset();
  assertPeptideUsable.mockReset();
  assertPrescriptionOwned.mockReset();
  assertSyringeUsable.mockReset();
  assertPrescriptionCompatible.mockReset();
  runPlannedDoseGeneration.mockReset();
  normaliseScheduleRule.mockReset();
  currentUser.mockResolvedValue({ id: "u1" });
  protocolUpdateMany.mockResolvedValue({ count: 1 });
  protocolCount.mockResolvedValue(0);
  // No sibling protocols for this peptide → no active-protocol conflict.
  protocolFindMany.mockResolvedValue([]);
  protocolCreate.mockResolvedValue({ id: "proto-1" });
  protocolStepCreateMany.mockResolvedValue({ count: 5 });
  transaction.mockImplementation(async (fn) => fn({
    protocol: { create: protocolCreate },
    protocolStep: { createMany: protocolStepCreateMany },
  }));
  normaliseScheduleRule.mockImplementation((rule) => ({ ok: true, rule }));
});

describe("stack protocol status cascade", () => {
  it("pauses stack siblings when a stack protocol is paused", async () => {
    protocolFindFirst.mockResolvedValue({ stackId: "stack-1", status: "active" });

    const result = await pauseProtocol("p1");

    expect(result.ok).toBe(true);
    expect(protocolUpdateMany).toHaveBeenCalledTimes(1);
    expect(protocolUpdateMany).toHaveBeenCalledWith({
      where: { stackId: "stack-1", userId: "u1", status: "active" },
      data: { status: "paused" },
    });
  });

  it("resumes stack siblings when a stack protocol is resumed", async () => {
    protocolFindFirst.mockResolvedValue({ stackId: "stack-1", status: "paused" });

    const result = await resumeProtocol("p1");

    expect(result.ok).toBe(true);
    expect(protocolUpdateMany).toHaveBeenCalledTimes(1);
    expect(protocolUpdateMany).toHaveBeenCalledWith({
      where: { stackId: "stack-1", userId: "u1", status: "paused" },
      data: { status: "active" },
    });
  });
});

describe("template titration protocol creation", () => {
  it("creates generated titration steps with a new protocol in one transaction", async () => {
    const result = await saveProtocol({
      peptideId: "pep-1",
      name: "MOTS-c Standard / Gradual Approach",
      source: "manual",
      scheduleType: "titration",
      scheduleRule: JSON.stringify([{ dayPattern: { kind: "daily" }, times: ["08:00"] }]),
      rebaseMode: "fixed_anchor",
      targetDose: "1000",
      doseInputUnit: "mcg",
      doseBasis: "per_injection",
      status: "active",
      steps: [
        { dose: "200", doseInputUnit: "mcg", durationDays: "14" },
        { dose: "400", doseInputUnit: "mcg", durationDays: "14" },
        { dose: "600", doseInputUnit: "mcg", durationDays: "14" },
        { dose: "800", doseInputUnit: "mcg", durationDays: "14" },
        { dose: "1000", doseInputUnit: "mcg" },
      ],
    });

    expect(result).toEqual({ ok: true, id: "proto-1" });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(protocolCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        peptideId: "pep-1",
        name: "MOTS-c Standard / Gradual Approach",
        scheduleType: "titration",
        targetDose: "1000",
      }),
    });
    expect(protocolStepCreateMany).toHaveBeenCalledWith({
      data: [
        { protocolId: "proto-1", stepIndex: 0, dose: "200", doseInputUnit: "mcg", durationDays: 14, notes: null },
        { protocolId: "proto-1", stepIndex: 1, dose: "400", doseInputUnit: "mcg", durationDays: 14, notes: null },
        { protocolId: "proto-1", stepIndex: 2, dose: "600", doseInputUnit: "mcg", durationDays: 14, notes: null },
        { protocolId: "proto-1", stepIndex: 3, dose: "800", doseInputUnit: "mcg", durationDays: 14, notes: null },
        { protocolId: "proto-1", stepIndex: 4, dose: "1000", doseInputUnit: "mcg", durationDays: null, notes: null },
      ],
    });
    expect(runPlannedDoseGeneration).toHaveBeenCalledWith("u1");
  });
});

describe("negative step duration is refused on every write path", () => {
  // The read path throws on a negative durationDays (phaseTargets), so a write
  // that accepted one would break every surface rendering the protocol. Each
  // action must refuse BEFORE touching the database — asserted here by checking
  // that no Prisma write was attempted.

  it("saveProtocol refuses, naming the offending step, and writes nothing", async () => {
    const result = await saveProtocol({
      peptideId: "pep-1",
      name: "Ramp with a typo",
      scheduleType: "titration",
      scheduleRule: JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "WE", "FR"] }, times: ["06:00"] }]),
      doseBasis: "per_injection",
      status: "active",
      steps: [
        { dose: "25", doseInputUnit: "mg", durationDays: "14" },
        { dose: "50", doseInputUnit: "mg", durationDays: "-7" },
      ],
    });

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toBe(`Step 2: ${NEGATIVE_DURATION_ERROR}`);
    expect(protocolCreate).not.toHaveBeenCalled();
    expect(protocolStepCreateMany).not.toHaveBeenCalled();
  });

  it("addProtocolStep refuses", async () => {
    const result = await addProtocolStep({
      protocolId: "proto-1",
      dose: "50",
      doseInputUnit: "mg",
      durationDays: "-1",
    });

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toBe(NEGATIVE_DURATION_ERROR);
  });

  it("addProtocolSteps refuses the whole ramp — all-or-nothing", async () => {
    const result = await addProtocolSteps({
      protocolId: "proto-1",
      steps: [
        { dose: "25", doseInputUnit: "mg", durationDays: "14" },
        { dose: "50", doseInputUnit: "mg", durationDays: "14" },
        { dose: "75", doseInputUnit: "mg", durationDays: "-14" },
      ],
    });

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toBe(`Step 3: ${NEGATIVE_DURATION_ERROR}`);
    expect(protocolStepCreateMany).not.toHaveBeenCalled();
  });

  it("updateProtocolStep refuses", async () => {
    const result = await updateProtocolStep({
      stepId: "step-1",
      dose: "50",
      doseInputUnit: "mg",
      durationDays: "-30",
    });

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toBe(NEGATIVE_DURATION_ERROR);
  });

  it("still accepts a positive duration and a blank (indefinite) one", async () => {
    const result = await saveProtocol({
      peptideId: "pep-1",
      name: "Valid ramp",
      scheduleType: "titration",
      scheduleRule: JSON.stringify([{ dayPattern: { kind: "weekly", byDays: ["MO", "WE", "FR"] }, times: ["06:00"] }]),
      doseBasis: "per_injection",
      status: "active",
      steps: [
        { dose: "25", doseInputUnit: "mg", durationDays: "14" },
        { dose: "50", doseInputUnit: "mg", durationDays: "" },
      ],
    });

    expect(result.ok).toBe(true);
  });
});

describe("updateProtocol — gantt quick edits (end date + cycle plan)", () => {
  const target = {
    startDate: new Date("2026-07-05T00:00:00.000Z"),
    endDate: new Date("2026-08-29T00:00:00.000Z"),
    stackId: null,
    cycleOnWeeks: 8,
    cycleOffWeeks: 4,
  };

  it("writes a new end date and regenerates planned doses", async () => {
    protocolFindFirst.mockResolvedValue({ ...target });
    const res = await updateProtocol({ id: "p1", endDateISO: "2026-09-05T00:00:00.000Z" });
    expect(res.ok).toBe(true);
    const data = protocolUpdateMany.mock.calls[0][0].data;
    expect(data.endDate).toEqual(new Date("2026-09-05T00:00:00.000Z"));
    // Untouched fields stay untouched — Prisma skips undefined.
    expect(data.startDate).toBeUndefined();
    expect(data.cycleOnWeeks).toBeUndefined();
    expect(runPlannedDoseGeneration).toHaveBeenCalledWith("u1");
  });

  it("refuses an end date before the stored start date, writing nothing", async () => {
    protocolFindFirst.mockResolvedValue({ ...target });
    const res = await updateProtocol({ id: "p1", endDateISO: "2026-07-01T00:00:00.000Z" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("End date is before this protocol's start date");
    expect(protocolUpdateMany).not.toHaveBeenCalled();
  });

  it("clearing the end date (null) persists an open-ended course", async () => {
    protocolFindFirst.mockResolvedValue({ ...target });
    const res = await updateProtocol({ id: "p1", endDateISO: null });
    expect(res.ok).toBe(true);
    expect(protocolUpdateMany.mock.calls[0][0].data.endDate).toBeNull();
  });

  it("merges a partial cycle edit over the stored plan and writes both columns", async () => {
    protocolFindFirst.mockResolvedValue({ ...target });
    const res = await updateProtocol({ id: "p1", cycleOffWeeks: 2 });
    expect(res.ok).toBe(true);
    const data = protocolUpdateMany.mock.calls[0][0].data;
    expect(data.cycleOnWeeks).toBe(8);
    expect(data.cycleOffWeeks).toBe(2);
  });

  it("clearing the on-cycle clears the break with it", async () => {
    protocolFindFirst.mockResolvedValue({ ...target });
    const res = await updateProtocol({ id: "p1", cycleOnWeeks: null });
    expect(res.ok).toBe(true);
    const data = protocolUpdateMany.mock.calls[0][0].data;
    expect(data.cycleOnWeeks).toBeNull();
    expect(data.cycleOffWeeks).toBeNull();
  });

  it("refuses a break when no on-cycle exists anywhere", async () => {
    protocolFindFirst.mockResolvedValue({ ...target, cycleOnWeeks: null, cycleOffWeeks: null });
    const res = await updateProtocol({ id: "p1", cycleOffWeeks: 4 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Set an on-cycle length before a break length.");
    expect(protocolUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses implausible week counts with the form's own message", async () => {
    protocolFindFirst.mockResolvedValue({ ...target });
    const res = await updateProtocol({ id: "p1", cycleOnWeeks: 500 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Cycle on-cycle must be between 1 and 104 weeks.");
  });

  it("cascades an end-date CHANGE to stack siblings, but never an echo", async () => {
    protocolFindFirst.mockResolvedValue({ ...target, stackId: "s1" });
    await updateProtocol({ id: "p1", endDateISO: "2026-09-05T00:00:00.000Z" });
    const sibling = protocolUpdateMany.mock.calls.find(
      (c) => c[0].where.stackId === "s1" && c[0].data.endDate !== undefined,
    );
    expect(sibling).toBeTruthy();
    // notIn [edited id, ...superseded predecessors] — semantically the old
    // { not } for a never-revised stack, and excludes frozen history after one.
    expect(sibling![0].where.id).toEqual({ notIn: ["p1"] });

    protocolUpdateMany.mockClear();
    protocolFindFirst.mockResolvedValue({ ...target, stackId: "s1" });
    await updateProtocol({ id: "p1", endDateISO: "2026-08-29T00:00:00.000Z" }); // echoed, unchanged
    const echoed = protocolUpdateMany.mock.calls.find((c) => c[0].where.stackId === "s1");
    expect(echoed).toBeUndefined();
  });

  it("moves and clears the cycle anchor independently", async () => {
    protocolFindFirst.mockResolvedValue({ ...target });
    await updateProtocol({ id: "p1", cycleAnchorISO: "2026-09-27T00:00:00.000Z" });
    expect(protocolUpdateMany.mock.calls[0][0].data.cycleAnchor).toEqual(new Date("2026-09-27T00:00:00.000Z"));

    protocolUpdateMany.mockClear();
    protocolFindFirst.mockResolvedValue({ ...target });
    await updateProtocol({ id: "p1", cycleAnchorISO: null });
    expect(protocolUpdateMany.mock.calls[0][0].data.cycleAnchor).toBeNull();
  });
});

describe("reviseProtocol keeps a stack component in its stack", () => {
  // The successor must inherit stackId (sibling cascades + grouped views key on
  // it) and vialId (dose resolution prefers the pinned vial) — dropping either
  // silently ejects a revised component from its stack.

  function armRevision(old: Record<string, unknown>) {
    currentUser.mockResolvedValue({ id: "u1" });
    protocolFindFirst.mockResolvedValue(old);
    doseLogFindFirst.mockResolvedValue(null);
    protocolCreate.mockResolvedValue({ id: "p-new" });
    transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        protocol: { updateMany: protocolUpdateMany, create: protocolCreate },
        auditLog: { create: auditLogCreate },
      }),
    );
    runPlannedDoseGeneration.mockResolvedValue(undefined);
  }

  it("carries stackId and vialId onto the successor", async () => {
    armRevision({ id: "p-old", peptideId: "pep1", courseId: null, status: "active", stackId: "stk1", vialId: "v9" });
    const res = await reviseProtocol({
      id: "p-old",
      startDate: "2026-09-01",
      next: { name: "CJC (stack) rev", peptideId: "pep1", scheduleType: "fixed_times", steps: [] },
    });
    expect(res.ok).toBe(true);
    const data = protocolCreate.mock.calls[0][0].data;
    expect(data.stackId).toBe("stk1");
    expect(data.vialId).toBe("v9");
  });

  it("leaves both null for a non-stack protocol (unchanged)", async () => {
    armRevision({ id: "p-old", peptideId: "pep1", courseId: null, status: "active", stackId: null, vialId: null });
    const res = await reviseProtocol({
      id: "p-old",
      startDate: "2026-09-01",
      next: { name: "solo rev", peptideId: "pep1", scheduleType: "fixed_times", steps: [] },
    });
    expect(res.ok).toBe(true);
    const data = protocolCreate.mock.calls[0][0].data;
    expect(data.stackId ?? null).toBeNull();
    expect(data.vialId ?? null).toBeNull();
  });
});

describe("updateProtocol start-date titration guard (review fix)", () => {
  it("refuses a start-date change on a titrating stack with delivered doses", async () => {
    currentUser.mockResolvedValue({ id: "u1" });
    protocolFindFirst.mockResolvedValue({
      startDate: new Date("2026-08-10T00:00:00Z"),
      endDate: null,
      stackId: "stk1",
      cycleOnWeeks: null,
      cycleOffWeeks: null,
    });
    protocolFindMany.mockResolvedValue([
      { id: "p1", courseId: null, status: "active", startDate: new Date("2026-08-10T00:00:00Z"), _count: { steps: 3, doseLogs: 21 } },
    ]);
    const res = await updateProtocol({ id: "p1", startDateISO: "2026-08-17" });
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.error).toMatch(/phase targets/);
    expect(protocolUpdateMany).not.toHaveBeenCalled();
  });

  it("still allows an end-date change on the same protocol (closing a course is safe)", async () => {
    currentUser.mockResolvedValue({ id: "u1" });
    protocolFindFirst.mockResolvedValue({
      startDate: new Date("2026-08-10T00:00:00Z"),
      endDate: null,
      stackId: null,
      cycleOnWeeks: null,
      cycleOffWeeks: null,
    });
    protocolUpdateMany.mockResolvedValue({ count: 1 });
    runPlannedDoseGeneration.mockResolvedValue(undefined);
    const res = await updateProtocol({ id: "p1", endDateISO: "2026-10-01" });
    expect(res.ok).toBe(true);
  });
});
