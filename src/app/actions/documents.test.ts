import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const documentCreate = vi.fn();
  const documentUpdate = vi.fn();
  const documentFindFirst = vi.fn();
  const documentDelete = vi.fn();
  const auditCreate = vi.fn();
  const prisma: Record<string, unknown> = {
    document: { create: documentCreate, update: documentUpdate, findFirst: documentFindFirst, delete: documentDelete },
    auditLog: { create: auditCreate },
  };
  Object.assign(prisma, { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)) });
  return {
    prisma, documentCreate, documentUpdate, documentFindFirst, documentDelete, auditCreate,
    currentUser: vi.fn(),
    revalidatePath: vi.fn(),
    saveDocumentFile: vi.fn(),
    deleteDocumentFile: vi.fn(),
    extractPdfText: vi.fn(),
    parseHologicReport: vi.fn(),
    sweepOrphanDocuments: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/auth/owner", () => ({ getCurrentUser: m.currentUser }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/documents", async () => {
  const real = await vi.importActual<typeof import("@/lib/documents")>("@/lib/documents");
  return {
    ...real,
    saveDocumentFile: m.saveDocumentFile,
    deleteDocumentFile: m.deleteDocumentFile,
  };
});
// The action reads the page-aware extractor; the mock returns a text-only result unless a test says otherwise.
vi.mock("@/lib/pdf-text", () => ({
  extractPdfTextPages: async (b: Buffer) => {
    const r = await m.extractPdfText(b);
    return typeof r === "string" ? { text: r, numPages: 2, pagesRead: 2 } : r;
  },
}));
vi.mock("@/lib/document-sweep", () => ({ sweepOrphanDocuments: m.sweepOrphanDocuments }));
vi.mock("@/lib/dexa-parse-core", () => ({ parseHologicReport: m.parseHologicReport }));

import { uploadDexaReport, discardDocument } from "./documents";
import { DocumentValidationError } from "@/lib/documents";

const PDF = new Uint8Array(Buffer.from("%PDF-1.4\n%%EOF"));
const fd = (file: File | null) => {
  const f = new FormData();
  if (file) f.set("file", file);
  return f;
};
const okParse = { ok: true, scan: { header: {} }, checks: [{ name: "x", pass: true, detail: "" }], confidence: 1, missing: [] };

beforeEach(() => {
  vi.clearAllMocks();
  m.currentUser.mockResolvedValue({ id: "u1" });
  m.saveDocumentFile.mockResolvedValue({ id: "fileid", filePath: "/store/u1/fileid.pdf" });
  m.documentCreate.mockResolvedValue({ id: "doc1" });
  m.documentUpdate.mockResolvedValue({});
  m.deleteDocumentFile.mockResolvedValue(undefined);
  m.extractPdfText.mockResolvedValue("text layer");
  m.parseHologicReport.mockReturnValue(okParse);
  m.sweepOrphanDocuments.mockResolvedValue(0);
});

describe("uploadDexaReport", () => {
  it("refuses without a session and without a file", async () => {
    m.currentUser.mockResolvedValueOnce(null);
    expect((await uploadDexaReport(fd(new File([PDF], "r.pdf")))).ok).toBe(false);
    const res = await uploadDexaReport(fd(null));
    expect(res.ok).toBe(false);
    expect(m.saveDocumentFile).not.toHaveBeenCalled();
  });

  it("stores the file, creates the Document row (pending → extracted), audits, returns the parse — no scan written", async () => {
    const res = await uploadDexaReport(fd(new File([PDF], "whatever-client-name.pdf", { type: "application/pdf" })));
    expect(res).toEqual({ ok: true, documentId: "doc1", parse: okParse });
    expect(m.saveDocumentFile).toHaveBeenCalledWith("u1", expect.any(Buffer), "pdf");
    expect(m.documentCreate.mock.calls[0][0].data).toEqual({
      userId: "u1", kind: "dexa_report", filePath: "/store/u1/fileid.pdf", mime: "application/pdf", extractionStatus: "pending",
    });
    expect(m.auditCreate.mock.calls[0][0].data).toMatchObject({ userId: "u1", entityType: "Document", entityId: "doc1", field: "upload" });
    expect(m.documentUpdate).toHaveBeenCalledWith({ where: { id: "doc1" }, data: { extractionStatus: "extracted", extractionConfidence: "1" } });
    expect(m.prisma).not.toHaveProperty("bodyCompScan");
  });

  it("a failed parse marks the document failed and still returns the parse (PDF stays attached)", async () => {
    const failed = { ok: false, scan: null, checks: [], confidence: 0.4, missing: ["header:sex"] };
    m.parseHologicReport.mockReturnValueOnce(failed);
    const res = await uploadDexaReport(fd(new File([PDF], "r.pdf")));
    expect(res.ok).toBe(true);
    expect(res.parse).toEqual(failed);
    expect(m.documentUpdate).toHaveBeenCalledWith({ where: { id: "doc1" }, data: { extractionStatus: "failed", extractionConfidence: "0.4" } });
  });

  it("an extraction error is reported as failed, not thrown, with no retry", async () => {
    m.extractPdfText.mockRejectedValueOnce(new Error("Invalid PDF structure"));
    const res = await uploadDexaReport(fd(new File([PDF], "r.pdf")));
    expect(res.ok).toBe(true);
    expect(res.parse?.ok).toBe(false);
    expect(res.parse?.missing.join(" ")).toMatch(/text layer/);
    expect(m.extractPdfText).toHaveBeenCalledTimes(1);
    expect(m.documentUpdate.mock.calls[0][0].data.extractionStatus).toBe("failed");
  });

  it("sweeps the user's abandoned uploads before storing a new one; a sweep failure never blocks the upload", async () => {
    await uploadDexaReport(fd(new File([PDF], "r.pdf")));
    expect(m.sweepOrphanDocuments).toHaveBeenCalledWith("u1");
    m.sweepOrphanDocuments.mockRejectedValueOnce(new Error("db hiccup"));
    const res = await uploadDexaReport(fd(new File([PDF], "r.pdf")));
    expect(res.ok).toBe(true);
  });

  it("a PDF with no text layer reports one 'no text' message, never the anchor list, and does not run the parser", async () => {
    m.extractPdfText.mockResolvedValueOnce("");
    const res = await uploadDexaReport(fd(new File([PDF], "scan.pdf")));
    expect(res.ok).toBe(true);
    expect(res.parse?.ok).toBe(false);
    expect(res.parse?.missing).toHaveLength(1);
    expect(res.parse?.missing[0]).toMatch(/no text in this PDF/);
    expect(m.parseHologicReport).not.toHaveBeenCalled();
    expect(m.documentUpdate.mock.calls[0][0].data.extractionStatus).toBe("failed");
  });

  it("names the unread pages when a failed parse came from a bundle longer than the page cap", async () => {
    m.extractPdfText.mockResolvedValueOnce({ text: "cover pages only", numPages: 10, pagesRead: 8 });
    m.parseHologicReport.mockReturnValueOnce({ ok: false, scan: null, checks: [], confidence: 0, missing: ["header:Sex"] });
    const res = await uploadDexaReport(fd(new File([PDF], "bundle.pdf")));
    expect(res.parse?.missing).toEqual(["header:Sex", "pages 9–10 (only the first 8 pages of a PDF are read)"]);
    // A successful parse within the cap says nothing about later pages.
    m.extractPdfText.mockResolvedValueOnce({ text: "report", numPages: 10, pagesRead: 8 });
    const ok = await uploadDexaReport(fd(new File([PDF], "bundle.pdf")));
    expect(ok.parse?.missing).toEqual([]);
  });

  it("surfaces the store's validation message (renamed .txt) and writes no row", async () => {
    m.saveDocumentFile.mockRejectedValueOnce(new DocumentValidationError("The file is not a PDF."));
    const res = await uploadDexaReport(fd(new File([new Uint8Array(Buffer.from("plain text"))], "fake.pdf")));
    expect(res).toEqual({ ok: false, error: "The file is not a PDF." });
    expect(m.documentCreate).not.toHaveBeenCalled();
  });

  it("refuses > 10 MB before reading the body", async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf");
    const res = await uploadDexaReport(fd(big));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/10 MB/);
    expect(m.saveDocumentFile).not.toHaveBeenCalled();
  });

  it("removes the stored file when the row cannot be created", async () => {
    m.documentCreate.mockRejectedValueOnce(new Error("db down"));
    const res = await uploadDexaReport(fd(new File([PDF], "r.pdf")));
    expect(res.ok).toBe(false);
    expect(m.deleteDocumentFile).toHaveBeenCalledWith("/store/u1/fileid.pdf");
  });
});

describe("discardDocument", () => {
  it("scopes the lookup to the session user; a foreign/missing id is a no-op", async () => {
    m.documentFindFirst.mockResolvedValueOnce(null);
    const res = await discardDocument("docX");
    expect(res).toEqual({ ok: true });
    expect(m.documentFindFirst.mock.calls[0][0].where).toEqual({ id: "docX", userId: "u1" });
    expect(m.documentDelete).not.toHaveBeenCalled();
  });

  it("refuses while a scan references it", async () => {
    m.documentFindFirst.mockResolvedValueOnce({ id: "doc1", kind: "dexa_report", extractionStatus: "confirmed", filePath: "/store/u1/f.pdf", _count: { bodyCompScans: 1, metabolicTests: 0 } });
    const res = await discardDocument("doc1");
    expect(res.ok).toBe(false);
    expect(m.documentDelete).not.toHaveBeenCalled();
    expect(m.deleteDocumentFile).not.toHaveBeenCalled();
  });

  it("deletes the row (audited) and then the file", async () => {
    m.documentFindFirst.mockResolvedValueOnce({ id: "doc1", kind: "dexa_report", extractionStatus: "extracted", filePath: "/store/u1/f.pdf", _count: { bodyCompScans: 0, metabolicTests: 0 } });
    const res = await discardDocument("doc1");
    expect(res).toEqual({ ok: true });
    expect(m.documentDelete).toHaveBeenCalledWith({ where: { id: "doc1" } });
    expect(m.auditCreate.mock.calls[0][0].data).toMatchObject({ entityType: "Document", entityId: "doc1", field: "discard" });
    expect(m.deleteDocumentFile).toHaveBeenCalledWith("/store/u1/f.pdf");
    expect(m.revalidatePath).toHaveBeenCalledWith("/body");
  });
});
