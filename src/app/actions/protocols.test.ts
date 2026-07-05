import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  protocolFindFirst,
  protocolUpdateMany,
  protocolCount,
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
} = vi.hoisted(() => ({
  protocolFindFirst: vi.fn(),
  protocolUpdateMany: vi.fn(),
  protocolCount: vi.fn(),
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
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    protocol: {
      findFirst: protocolFindFirst,
      updateMany: protocolUpdateMany,
      count: protocolCount,
      create: protocolCreate,
    },
    protocolStep: {
      createMany: protocolStepCreateMany,
    },
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

import { pauseProtocol, resumeProtocol, saveProtocol } from "./protocols";

beforeEach(() => {
  protocolFindFirst.mockReset();
  protocolUpdateMany.mockReset();
  protocolCount.mockReset();
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
