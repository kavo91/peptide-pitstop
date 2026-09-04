import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Document linking on scan create/delete. Scan validation itself is covered by
 * the pure core tests; here the mocks assert the transaction shape: a linked
 * report is ownership-checked, confirmed with the scan, and removed with it.
 */
const m = vi.hoisted(() => {
  const scanCreate = vi.fn();
  const scanFindUnique = vi.fn();
  const scanDelete = vi.fn();
  const regionDeleteMany = vi.fn();
  const testUpdateMany = vi.fn();
  const documentFindFirst = vi.fn();
  const documentUpdate = vi.fn();
  const documentDelete = vi.fn();
  const auditCreate = vi.fn();
  const prisma: Record<string, unknown> = {
    bodyCompScan: { create: scanCreate, findUnique: scanFindUnique, delete: scanDelete },
    bodyCompRegion: { deleteMany: regionDeleteMany },
    metabolicTest: { updateMany: testUpdateMany },
    document: { findFirst: documentFindFirst, update: documentUpdate, delete: documentDelete },
    auditLog: { create: auditCreate },
  };
  Object.assign(prisma, { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)) });
  return { prisma, scanCreate, scanFindUnique, scanDelete, regionDeleteMany, testUpdateMany, documentFindFirst, documentUpdate, documentDelete, auditCreate, currentUser: vi.fn(), revalidatePath: vi.fn(), deleteDocumentFile: vi.fn() };
});

vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/auth/owner", () => ({ getCurrentUser: m.currentUser }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/documents", () => ({ deleteDocumentFile: m.deleteDocumentFile }));
vi.mock("@/lib/crypto/fieldEncryption", () => ({
  encryptField: (v: string | null | undefined) => (v == null ? null : `ENC(${v})`),
  decryptField: (v: string | null | undefined) => (v == null ? null : v.replace(/^ENC\((.*)\)$/, "$1")),
}));

import { createBodyCompScan, deleteBodyCompScan, type CreateScanInput } from "./bodycomp";

// SYNTHETIC minimal scan (the phase-1 invented subject).
const INPUT: CreateScanInput = {
  scannedAt: "2026-01-10T00:00:00.000Z", tz: "Australia/Brisbane", sex: "male", ageYears: "40", heightCm: "178",
  totalFatG: "16400", totalLeanG: "61800", totalBmcG: "2800", totalMassG: "81000", pctFat: "20.2",
  prep: { fasted: null, noCaffeine: null, noTrainingPriorDay: null, activeTravel: null, euhydratedVoided: null, illnessFree14d: null },
  regions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.currentUser.mockResolvedValue({ id: "u1" });
  m.scanCreate.mockResolvedValue({ id: "scan1" });
  m.deleteDocumentFile.mockResolvedValue(undefined);
});

describe("createBodyCompScan with documentId", () => {
  it("without a document: no document lookup, documentId null on the row", async () => {
    const res = await createBodyCompScan(INPUT);
    expect(res.ok).toBe(true);
    expect(m.documentFindFirst).not.toHaveBeenCalled();
    expect(m.scanCreate.mock.calls[0][0].data.documentId).toBeNull();
    expect(m.documentUpdate).not.toHaveBeenCalled();
  });

  it("refuses a document that is not the user's dexa_report (ownership-scoped query)", async () => {
    m.documentFindFirst.mockResolvedValueOnce(null);
    const res = await createBodyCompScan({ ...INPUT, documentId: "docX" });
    expect(res).toEqual({ ok: false, error: "Uploaded report not found." });
    expect(m.documentFindFirst.mock.calls[0][0].where).toEqual({ id: "docX", userId: "u1", kind: "dexa_report" });
    expect(m.scanCreate).not.toHaveBeenCalled();
  });

  it("refuses a document already linked to a scan", async () => {
    m.documentFindFirst.mockResolvedValueOnce({ id: "doc1", _count: { bodyCompScans: 1 } });
    const res = await createBodyCompScan({ ...INPUT, documentId: "doc1" });
    expect(res.ok).toBe(false);
    expect(m.scanCreate).not.toHaveBeenCalled();
  });

  it("links the document and marks it confirmed in the same transaction, audited", async () => {
    m.documentFindFirst.mockResolvedValueOnce({ id: "doc1", _count: { bodyCompScans: 0 } });
    const res = await createBodyCompScan({ ...INPUT, documentId: "doc1" });
    expect(res.ok).toBe(true);
    expect(m.scanCreate.mock.calls[0][0].data.documentId).toBe("doc1");
    expect(m.documentUpdate).toHaveBeenCalledWith({ where: { id: "doc1" }, data: { extractionStatus: "confirmed" } });
    const audits = m.auditCreate.mock.calls.map((c) => c[0].data);
    expect(audits).toContainEqual(expect.objectContaining({ entityType: "Document", entityId: "doc1", field: "confirm", newValue: "scan scan1" }));
    // every report-derived number still encrypted
    const data = m.scanCreate.mock.calls[0][0].data;
    expect(data.totalFatG).toBe("ENC(16400)");
    expect(data.pctFat).toBe("ENC(20.2)");
  });
});

describe("deleteBodyCompScan document cleanup", () => {
  const scan = { id: "scan1", userId: "u1", scannedAt: new Date("2026-01-10T00:00:00Z"), documentId: "doc1" };

  it("removes the linked document row in the transaction and the file after it", async () => {
    m.scanFindUnique.mockResolvedValueOnce(scan);
    m.documentFindFirst.mockResolvedValueOnce({ id: "doc1", filePath: "/store/u1/doc1.pdf", _count: { bodyCompScans: 0, metabolicTests: 0 } });
    const res = await deleteBodyCompScan("scan1");
    expect(res).toEqual({ ok: true });
    expect(m.scanDelete).toHaveBeenCalledWith({ where: { id: "scan1" } });
    expect(m.documentFindFirst.mock.calls[0][0].where).toEqual({ id: "doc1", userId: "u1" });
    expect(m.documentDelete).toHaveBeenCalledWith({ where: { id: "doc1" } });
    expect(m.deleteDocumentFile).toHaveBeenCalledWith("/store/u1/doc1.pdf");
    const audits = m.auditCreate.mock.calls.map((c) => c[0].data);
    expect(audits).toContainEqual(expect.objectContaining({ entityType: "Document", entityId: "doc1", field: "delete" }));
  });

  it("keeps the document when something else still references it", async () => {
    m.scanFindUnique.mockResolvedValueOnce(scan);
    m.documentFindFirst.mockResolvedValueOnce({ id: "doc1", filePath: "/store/u1/doc1.pdf", _count: { bodyCompScans: 0, metabolicTests: 1 } });
    const res = await deleteBodyCompScan("scan1");
    expect(res.ok).toBe(true);
    expect(m.documentDelete).not.toHaveBeenCalled();
    expect(m.deleteDocumentFile).not.toHaveBeenCalled();
  });

  it("no document: no document calls at all", async () => {
    m.scanFindUnique.mockResolvedValueOnce({ ...scan, documentId: null });
    const res = await deleteBodyCompScan("scan1");
    expect(res.ok).toBe(true);
    expect(m.documentFindFirst).not.toHaveBeenCalled();
    expect(m.deleteDocumentFile).not.toHaveBeenCalled();
  });

  it("a failed unlink after commit does not fail the delete (orphan file, never a dangling row)", async () => {
    m.scanFindUnique.mockResolvedValueOnce(scan);
    m.documentFindFirst.mockResolvedValueOnce({ id: "doc1", filePath: "/store/u1/doc1.pdf", _count: { bodyCompScans: 0, metabolicTests: 0 } });
    m.deleteDocumentFile.mockRejectedValueOnce(new Error("EACCES"));
    const res = await deleteBodyCompScan("scan1");
    expect(res).toEqual({ ok: true });
  });
});
