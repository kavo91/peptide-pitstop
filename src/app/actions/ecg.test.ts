import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The import action's contract: read the PDF, save the recording, and leave
 * nothing behind when it cannot. The parsing itself is covered by the pure core
 * tests; here the mocks assert the SHAPE — what is written, what is deleted,
 * what happens on a second upload of the same recording, and that the PII on
 * the page never reaches a column.
 *
 * Every fixture is synthetic. No real report is used anywhere in this repo.
 */

const m = vi.hoisted(() => {
  const ecgFindFirst = vi.fn();
  const ecgFindUnique = vi.fn();
  const ecgCreate = vi.fn();
  const ecgUpdate = vi.fn();
  const ecgDelete = vi.fn();
  const documentCreate = vi.fn();
  const documentDelete = vi.fn();
  const auditCreate = vi.fn();
  const prisma: Record<string, unknown> = {
    ecgRecording: { findFirst: ecgFindFirst, findUnique: ecgFindUnique, create: ecgCreate, update: ecgUpdate, delete: ecgDelete },
    document: { create: documentCreate, delete: documentDelete },
    auditLog: { create: auditCreate },
  };
  Object.assign(prisma, { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)) });
  return {
    prisma, ecgFindFirst, ecgFindUnique, ecgCreate, ecgUpdate, ecgDelete,
    documentCreate, documentDelete, auditCreate,
    currentUser: vi.fn(), revalidatePath: vi.fn(),
    saveDocumentFile: vi.fn(), deleteDocumentFile: vi.fn(), sweep: vi.fn(),
    extract: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/auth/owner", () => ({ getCurrentUser: m.currentUser }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/document-sweep", () => ({ sweepOrphanDocuments: m.sweep }));
vi.mock("@/lib/ecg-pdf", () => ({ extractEcgPdf: m.extract }));
vi.mock("@/lib/documents", async () => {
  const actual = await vi.importActual<typeof import("@/lib/documents")>("@/lib/documents");
  return {
    MAX_DOCUMENT_BYTES: actual.MAX_DOCUMENT_BYTES,
    DocumentValidationError: actual.DocumentValidationError,
    saveDocumentFile: m.saveDocumentFile,
    deleteDocumentFile: m.deleteDocumentFile,
  };
});
vi.mock("@/lib/crypto/fieldEncryption", () => ({
  encryptField: (v: string | null | undefined) => (v == null ? null : `ENC(${v})`),
  decryptField: (v: string | null | undefined) => (v == null ? null : v.replace(/^ENC\((.*)\)$/, "$1")),
}));

import { deleteEcgRecording, importEcgReports } from "./ecg";
import type { PdfTextItem } from "@/lib/ecg-parse-core";

const UNITS_PER_MM = 72 / 25.4;

function item(str: string, x: number, y: number, height = 10): PdfTextItem {
  return { str, x, y, width: str.length * height * 0.5, height };
}

/** The synthetic report layout, reduced to what the action needs to succeed. */
function content(recordedAt = "12 June 2024 @ 9:17 AM") {
  const items: PdfTextItem[] = [
    item("Sinus Rhythm", 30, 526.2, 12),
    item("Result", 30, 515.2, 7),
    item("61 bpm", 224.4, 526.2, 12),
    item("Average Heart Rate", 224.4, 515.2, 7),
    item("--", 418.8, 526.2, 12),
    item("Symptoms Reported", 418.8, 515.2, 7),
    item("This ECG recording does not show signs of AFib.", 30, 485.3, 12),
    item("Summary", 30, 474.3, 7),
    item("25mm/s, 10mm/mV, 512Hz, fenix 9 Pro - inReach, 43 mm SW 6.38, Garmin ECG App: 1.1.4, Garmin Connect Web 5.28.0.26a, PDF Template 1.2.114, Garmin Connect Backend 25.16.0.", 30, 126.2, 8),
    item("This waveform is similar to a Lead I ECG. For more information, see Instructions for Use.", 30, 115.3, 8),
    item(recordedAt, 66, 562.7, 10.5),
    item("Jordan Fixtureson", 694.4, 563.4, 10),
    item("4 March 1979 (45 yr) - Female", 656, 566, 7),
    item("29s", 675, 143.3, 7),
  ];
  const trace = Array.from({ length: 250 }, (_, i) => ({ x: 33 + i * 2.8, y: 400 + (i === 100 ? 10 * UNITS_PER_MM : 0) }));
  return { items, traces: [trace] };
}

function upload(files: { name: string; bytes?: string }[], tz = "Australia/Brisbane"): FormData {
  const fd = new FormData();
  for (const f of files) {
    fd.append("files", new File([new TextEncoder().encode(f.bytes ?? "%PDF-1.7 synthetic")], f.name, { type: "application/pdf" }));
  }
  fd.set("tz", tz);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.currentUser.mockResolvedValue({ id: "u1" });
  m.sweep.mockResolvedValue(0);
  m.extract.mockResolvedValue(content());
  m.ecgFindFirst.mockResolvedValue(null);
  m.ecgFindUnique.mockResolvedValue(null);
  m.saveDocumentFile.mockResolvedValue({ id: "f1", filePath: "/store/u1/f1.pdf" });
  m.documentCreate.mockResolvedValue({ id: "doc1" });
  m.ecgCreate.mockResolvedValue({ id: "rec1" });
  m.deleteDocumentFile.mockResolvedValue(undefined);
});

describe("importEcgReports", () => {
  it("refuses before touching anything when there is no session", async () => {
    m.currentUser.mockResolvedValueOnce(null);
    const res = await importEcgReports(upload([{ name: "a.pdf" }]));
    expect(res.ok).toBe(false);
    expect(m.extract).not.toHaveBeenCalled();
    expect(m.saveDocumentFile).not.toHaveBeenCalled();
  });

  it("imports with nothing to confirm: one upload becomes one saved recording", async () => {
    const res = await importEcgReports(upload([{ name: "ecg.pdf" }]));
    expect(res.ok).toBe(true);
    expect(res.outcomes).toHaveLength(1);
    expect(res.outcomes[0]!.status).toBe("imported");
    expect(m.ecgCreate).toHaveBeenCalledTimes(1);
    const data = m.ecgCreate.mock.calls[0][0].data;
    expect(data.result).toBe("ENC(Sinus Rhythm)");
    expect(data.avgHeartRateBpm).toBe("ENC(61)");
    expect(data.documentId).toBe("doc1");
    expect(m.documentCreate.mock.calls[0][0].data.kind).toBe("ecg_report");
    expect(m.revalidatePath).toHaveBeenCalledWith("/journal");
  });

  it("stores the recording time from the document, in the zone the browser sent", async () => {
    await importEcgReports(upload([{ name: "ecg.pdf" }], "Australia/Brisbane"));
    const data = m.ecgCreate.mock.calls[0][0].data;
    // 09:17 in UTC+10 is 23:17 UTC on the day before.
    expect((data.recordedAt as Date).toISOString()).toBe("2024-06-11T23:17:00.000Z");
    expect(data.localDay).toBe("2024-06-12");
    expect(data.tz).toBe("Australia/Brisbane");
  });

  it("identifies a recording by the PRINTED time, so importing from another zone is not a second recording", async () => {
    await importEcgReports(upload([{ name: "ecg.pdf" }], "Australia/Brisbane"));
    const fromHome = m.ecgCreate.mock.calls[0][0].data.recordedLocalKey;
    const lookupHome = m.ecgFindUnique.mock.calls[0][0].where.userId_recordedLocalKey;

    vi.clearAllMocks();
    m.currentUser.mockResolvedValue({ id: "u1" });
    m.sweep.mockResolvedValue(0);
    m.extract.mockResolvedValue(content());
    m.ecgFindFirst.mockResolvedValue(null);
    m.ecgFindUnique.mockResolvedValue(null);
    m.saveDocumentFile.mockResolvedValue({ id: "f2", filePath: "/store/u1/f2.pdf" });
    m.documentCreate.mockResolvedValue({ id: "doc2" });
    m.ecgCreate.mockResolvedValue({ id: "rec2" });

    await importEcgReports(upload([{ name: "ecg.pdf", bytes: "%PDF-other" }], "America/New_York"));
    const fromAway = m.ecgCreate.mock.calls[0][0].data;
    // Different instant, SAME identity — so the second import finds the first.
    expect(fromAway.recordedLocalKey).toBe(fromHome);
    expect(fromAway.recordedLocalKey).toBe("2024-06-12T09:17");
    expect((fromAway.recordedAt as Date).toISOString()).not.toBe("2024-06-11T23:17:00.000Z");
    expect(m.ecgFindUnique.mock.calls[0][0].where.userId_recordedLocalKey).toEqual(lookupHome);
  });

  it("refuses to overwrite a DIFFERENT recording that shares the printed minute", async () => {
    m.ecgFindUnique.mockResolvedValueOnce({ id: "rec1", waveformPoints: 900, durationSec: 30, document: null });
    const res = await importEcgReports(upload([{ name: "ecg.pdf" }]));
    expect(res.outcomes[0]!.status).toBe("failed");
    expect(res.outcomes[0]!.message).toMatch(/different recording is already stored/i);
    expect(m.ecgUpdate).not.toHaveBeenCalled();
    expect(m.saveDocumentFile).not.toHaveBeenCalled();
  });

  it("still refreshes when the trace matches — a re-download is not a different recording", async () => {
    m.ecgFindUnique.mockResolvedValueOnce({ id: "rec1", waveformPoints: 250, durationSec: 30, document: null });
    const res = await importEcgReports(upload([{ name: "ecg.pdf" }]));
    expect(res.outcomes[0]!.status).toBe("updated");
    expect(m.ecgUpdate).toHaveBeenCalledTimes(1);
  });

  it("reports a lost race as the duplicate it is, not as a storage failure", async () => {
    const conflict = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    m.ecgCreate.mockRejectedValueOnce(conflict);
    const res = await importEcgReports(upload([{ name: "ecg.pdf" }]));
    expect(res.outcomes[0]!.status).toBe("duplicate");
    expect(m.deleteDocumentFile).toHaveBeenCalledWith("/store/u1/f1.pdf");
  });

  it("puts the same wall-clock reading at a different instant in a different zone", async () => {
    await importEcgReports(upload([{ name: "ecg.pdf" }], "Europe/London"));
    const data = m.ecgCreate.mock.calls[0][0].data;
    expect((data.recordedAt as Date).toISOString()).toBe("2024-06-12T08:17:00.000Z");
  });

  it("encrypts every clinical value and leaves the provenance readable", async () => {
    await importEcgReports(upload([{ name: "ecg.pdf" }]));
    const data = m.ecgCreate.mock.calls[0][0].data;
    for (const f of ["result", "interpretation", "waveformJson"]) {
      expect(String(data[f])).toMatch(/^ENC\(/);
    }
    expect(data.pdfTemplateVersion).toBe("1.2.114");
    expect(data.deviceModel).toBe("fenix 9 Pro - inReach, 43 mm");
    expect(data.waveformPoints).toBe(250);
  });

  it("writes no name, date of birth, age or sex, even though all four are on the page", async () => {
    await importEcgReports(upload([{ name: "ecg.pdf" }]));
    const written = JSON.stringify(m.ecgCreate.mock.calls[0][0].data);
    for (const pii of ["Jordan", "Fixtureson", "1979", "Female"]) expect(written).not.toContain(pii);
  });

  it("recognises a file it already holds and stores nothing a second time", async () => {
    m.ecgFindFirst.mockResolvedValueOnce({ recordedAt: new Date("2024-06-11T23:17:00.000Z") });
    const res = await importEcgReports(upload([{ name: "ecg.pdf" }]));
    expect(res.outcomes[0]!.status).toBe("duplicate");
    expect(m.extract).not.toHaveBeenCalled();
    expect(m.saveDocumentFile).not.toHaveBeenCalled();
    expect(m.ecgCreate).not.toHaveBeenCalled();
  });

  it("refreshes the recording already stored for that time instead of adding a second one", async () => {
    m.ecgFindUnique.mockResolvedValueOnce({ id: "rec1", waveformPoints: 250, durationSec: 30, document: { id: "old-doc", filePath: "/store/u1/old.pdf" } });
    const res = await importEcgReports(upload([{ name: "ecg-again.pdf" }]));
    expect(res.outcomes[0]!.status).toBe("updated");
    expect(m.ecgCreate).not.toHaveBeenCalled();
    expect(m.ecgUpdate).toHaveBeenCalledTimes(1);
    expect(m.ecgUpdate.mock.calls[0][0].data.documentId).toBe("doc1");
    // The superseded upload goes only after the row points at the new one.
    expect(m.documentDelete).toHaveBeenCalledWith({ where: { id: "old-doc" } });
    expect(m.deleteDocumentFile).toHaveBeenCalledWith("/store/u1/old.pdf");
  });

  it("leaves nothing stored when the PDF is not a Garmin ECG report", async () => {
    m.extract.mockResolvedValueOnce({ items: [{ str: "Invoice", x: 30, y: 500, width: 20, height: 10 }], traces: [] });
    const res = await importEcgReports(upload([{ name: "invoice.pdf" }]));
    expect(res.outcomes[0]!.status).toBe("failed");
    expect(m.saveDocumentFile).not.toHaveBeenCalled();
    expect(m.documentCreate).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("says plainly that the wrong file was chosen, without listing every field it lacks", async () => {
    m.extract.mockResolvedValueOnce({ items: [{ str: "Invoice", x: 30, y: 500, width: 20, height: 10 }], traces: [] });
    const res = await importEcgReports(upload([{ name: "invoice.pdf" }]));
    expect(res.outcomes[0]!.message).toBe("This does not look like a Garmin ECG report.");
    expect(res.outcomes[0]!.message).not.toMatch(/Could not find/);
  });

  it("does name the missing fields when the report was PARTLY readable — that points at a template change", async () => {
    // Everything but the result column: this IS an ECG report the parser has
    // half-understood, which is worth reporting in detail.
    const partial = content();
    m.extract.mockResolvedValueOnce({ ...partial, items: partial.items.filter((i) => i.str !== "Result") });
    const res = await importEcgReports(upload([{ name: "newer-template.pdf" }]));
    expect(res.outcomes[0]!.status).toBe("failed");
    expect(res.outcomes[0]!.message).toMatch(/Could not find: result/);
  });

  it("removes the stored file when the row cannot be written", async () => {
    m.documentCreate.mockRejectedValueOnce(new Error("disk full"));
    const res = await importEcgReports(upload([{ name: "ecg.pdf" }]));
    expect(res.outcomes[0]!.status).toBe("failed");
    expect(m.deleteDocumentFile).toHaveBeenCalledWith("/store/u1/f1.pdf");
  });

  it("keeps going after a bad file: one unreadable report does not lose the others", async () => {
    m.extract
      .mockResolvedValueOnce({ items: [], traces: [] })
      .mockResolvedValueOnce(content("13 June 2024 @ 7:15 AM"));
    const res = await importEcgReports(upload([{ name: "broken.pdf", bytes: "%PDF-a" }, { name: "good.pdf", bytes: "%PDF-b" }]));
    expect(res.outcomes.map((o) => o.status)).toEqual(["failed", "imported"]);
    expect(m.ecgCreate).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty selection and a batch beyond the limit", async () => {
    expect((await importEcgReports(new FormData())).ok).toBe(false);
    const many = upload(Array.from({ length: 26 }, (_, i) => ({ name: `${i}.pdf`, bytes: `%PDF-${i}` })));
    const res = await importEcgReports(many);
    expect(res.ok).toBe(false);
    expect(m.extract).not.toHaveBeenCalled();
  });

  it("falls back to the server zone when the browser sends a junk timezone", async () => {
    await importEcgReports(upload([{ name: "ecg.pdf" }], "Mars/Olympus_Mons"));
    // The suite pins TZ=Australia/Brisbane, the same zone the container runs in.
    expect((m.ecgCreate.mock.calls[0][0].data.recordedAt as Date).toISOString()).toBe("2024-06-11T23:17:00.000Z");
  });

  it("labels a file with no usable name rather than printing raw bytes back", async () => {
    const fd = new FormData();
    fd.append("files", new File([new TextEncoder().encode("%PDF-x")], "", { type: "application/pdf" }));
    const res = await importEcgReports(fd);
    expect(res.outcomes[0]!.file).toBe("File 1");
  });
});

describe("deleteEcgRecording", () => {
  it("removes the recording, its document row and its stored file", async () => {
    m.ecgFindFirst.mockResolvedValueOnce({ id: "rec1", recordedAt: new Date("2024-06-11T23:17:00.000Z"), document: { id: "doc1", filePath: "/store/u1/f1.pdf" } });
    const res = await deleteEcgRecording("rec1");
    expect(res.ok).toBe(true);
    expect(m.ecgDelete).toHaveBeenCalledWith({ where: { id: "rec1" } });
    expect(m.documentDelete).toHaveBeenCalledWith({ where: { id: "doc1" } });
    expect(m.deleteDocumentFile).toHaveBeenCalledWith("/store/u1/f1.pdf");
  });

  it("looks the row up scoped to its owner, so another user's id deletes nothing", async () => {
    m.currentUser.mockResolvedValueOnce({ id: "someone-else" });
    m.ecgFindFirst.mockResolvedValueOnce(null);
    const res = await deleteEcgRecording("rec1");
    expect(res.ok).toBe(true);
    expect(m.ecgFindFirst.mock.calls[0][0].where).toEqual({ id: "rec1", userId: "someone-else" });
    expect(m.ecgDelete).not.toHaveBeenCalled();
  });
});
