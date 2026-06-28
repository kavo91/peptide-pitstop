import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB so the guards run against in-memory stubs (mirrors the pattern in
// src/app/api/wellness/garmin/route.test.ts). `vi.hoisted` keeps the mock fns
// referenceable from the hoisted factory.
const { peptideFindUnique, prescriptionFindUnique, syringeFindUnique } = vi.hoisted(() => ({
  peptideFindUnique: vi.fn(),
  prescriptionFindUnique: vi.fn(),
  syringeFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    peptide: { findUnique: peptideFindUnique },
    prescription: { findUnique: prescriptionFindUnique },
    syringe: { findUnique: syringeFindUnique },
  },
}));

import { assertPeptideUsable, assertPrescriptionOwned, assertSyringeUsable } from "./ownership";

const USER = "user-1";
const OTHER = "user-2";

beforeEach(() => vi.clearAllMocks());

describe("assertPeptideUsable", () => {
  it("no-ops on null/undefined id (optional FK)", async () => {
    await expect(assertPeptideUsable(USER, null)).resolves.toBeUndefined();
    await expect(assertPeptideUsable(USER, undefined)).resolves.toBeUndefined();
    expect(peptideFindUnique).not.toHaveBeenCalled();
  });

  it("allows an owned peptide", async () => {
    peptideFindUnique.mockResolvedValue({ userId: USER });
    await expect(assertPeptideUsable(USER, "p1")).resolves.toBeUndefined();
  });

  it("allows a shared peptide (userId null)", async () => {
    peptideFindUnique.mockResolvedValue({ userId: null });
    await expect(assertPeptideUsable(USER, "p1")).resolves.toBeUndefined();
  });

  it("rejects another user's peptide", async () => {
    peptideFindUnique.mockResolvedValue({ userId: OTHER });
    await expect(assertPeptideUsable(USER, "p1")).rejects.toThrow("Peptide not found.");
  });

  it("rejects a missing peptide", async () => {
    peptideFindUnique.mockResolvedValue(null);
    await expect(assertPeptideUsable(USER, "nope")).rejects.toThrow("Peptide not found.");
  });
});

describe("assertPrescriptionOwned", () => {
  it("no-ops on null id", async () => {
    await expect(assertPrescriptionOwned(USER, null)).resolves.toBeUndefined();
    expect(prescriptionFindUnique).not.toHaveBeenCalled();
  });

  it("allows an owned prescription", async () => {
    prescriptionFindUnique.mockResolvedValue({ userId: USER });
    await expect(assertPrescriptionOwned(USER, "rx1")).resolves.toBeUndefined();
  });

  it("rejects another user's prescription (prescriptions are never shared)", async () => {
    prescriptionFindUnique.mockResolvedValue({ userId: OTHER });
    await expect(assertPrescriptionOwned(USER, "rx1")).rejects.toThrow("Prescription not found.");
  });

  it("rejects a missing prescription", async () => {
    prescriptionFindUnique.mockResolvedValue(null);
    await expect(assertPrescriptionOwned(USER, "nope")).rejects.toThrow("Prescription not found.");
  });
});

describe("assertSyringeUsable", () => {
  it("no-ops on null id", async () => {
    await expect(assertSyringeUsable(USER, null)).resolves.toBeUndefined();
    expect(syringeFindUnique).not.toHaveBeenCalled();
  });

  it("allows an owned syringe", async () => {
    syringeFindUnique.mockResolvedValue({ userId: USER });
    await expect(assertSyringeUsable(USER, "s1")).resolves.toBeUndefined();
  });

  it("allows a shared syringe (userId null)", async () => {
    syringeFindUnique.mockResolvedValue({ userId: null });
    await expect(assertSyringeUsable(USER, "s1")).resolves.toBeUndefined();
  });

  it("rejects another user's syringe", async () => {
    syringeFindUnique.mockResolvedValue({ userId: OTHER });
    await expect(assertSyringeUsable(USER, "s1")).rejects.toThrow("Syringe not found.");
  });

  it("rejects a missing syringe", async () => {
    syringeFindUnique.mockResolvedValue(null);
    await expect(assertSyringeUsable(USER, "nope")).rejects.toThrow("Syringe not found.");
  });
});
