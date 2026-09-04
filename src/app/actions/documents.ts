"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { DocumentValidationError, MAX_DOCUMENT_BYTES, deleteDocumentFile, saveDocumentFile } from "@/lib/documents";
import { extractPdfTextPages } from "@/lib/pdf-text";
import { sweepOrphanDocuments } from "@/lib/document-sweep";
import { parseHologicReport, type ParseResult } from "@/lib/dexa-parse-core";

export interface UploadDexaReportResult { ok: boolean; documentId?: string; parse?: ParseResult; error?: string }

/** Duck-typed `File`/`Blob` check — the global `File` class differs between runtimes. */
function isBlobLike(v: unknown): v is Blob {
  return typeof v === "object" && v != null && typeof (v as Blob).arrayBuffer === "function" && typeof (v as Blob).size === "number";
}

/**
 * Upload a DEXA report PDF: validate the bytes, store the file, create the
 * `Document` row, extract the text layer and run the Hologic parser. Returns
 * the parse for the review panel; NO scan is written here — the user confirms
 * (or enters manually) and `createBodyCompScan` links the document by id.
 *
 * Extraction is a single attempt: an extractor error is reported as a
 * `failed` parse (never thrown to the client). The one-retry wrapper that
 * covered pdf-parse's intermittent `bad XRef entry` was removed with it —
 * the pdf.js legacy extractor passed 50/50 harness uploads (25 sequential,
 * 25 at concurrency 3) through this action with no retry, 2026-09-02.
 */
export async function uploadDexaReport(formData: FormData): Promise<UploadDexaReportResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Abandoned earlier uploads (never confirmed, older than the TTL) go before a new one is stored.
  await sweepOrphanDocuments(user.id).catch((e) => console.error("uploadDexaReport: orphan sweep failed", e));

  const file = formData.get("file");
  if (!isBlobLike(file)) return { ok: false, error: "Choose a PDF file." };
  if (file.size > MAX_DOCUMENT_BYTES) return { ok: false, error: "The file is larger than 10 MB." };

  // A plain Node Buffer copy of the upload (≤ 10 MB once): the store writes it, the
  // parser reads it, and nothing downstream holds a view on the request's buffer.
  const buffer = Buffer.from(new Uint8Array(await file.arrayBuffer()));
  let saved: { id: string; filePath: string };
  try {
    saved = await saveDocumentFile(user.id, buffer, "pdf");
  } catch (e) {
    if (e instanceof DocumentValidationError) return { ok: false, error: e.message };
    console.error("uploadDexaReport: save failed", e);
    return { ok: false, error: "Could not store the file. Please try again." };
  }

  let documentId: string;
  try {
    const doc = await prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: { userId: user.id, kind: "dexa_report", filePath: saved.filePath, mime: "application/pdf", extractionStatus: "pending" },
      });
      await tx.auditLog.create({
        data: { userId: user.id, entityType: "Document", entityId: created.id, field: "upload", newValue: `dexa_report ${buffer.length} bytes` },
      });
      return created;
    });
    documentId = doc.id;
  } catch (e) {
    console.error("uploadDexaReport: row create failed", e);
    await deleteDocumentFile(saved.filePath).catch(() => undefined);
    return { ok: false, error: "Could not record the upload. Please try again." };
  }

  let parse: ParseResult;
  try {
    const { text, numPages, pagesRead } = await extractPdfTextPages(buffer);
    if (!text.trim()) {
      // One message, not 42 "missing anchor" pills: there is no text layer to search.
      parse = { ok: false, scan: null, checks: [], confidence: 0, missing: ["text layer (no text in this PDF — a scanned image; enter the values by hand)"] };
    } else {
      parse = parseHologicReport(text);
      if (!parse.ok && numPages > pagesRead) {
        parse = { ...parse, missing: [...parse.missing, `pages ${pagesRead + 1}–${numPages} (only the first ${pagesRead} pages of a PDF are read)`] };
      }
    }
  } catch (e) {
    console.error("uploadDexaReport: extraction failed", e);
    parse = { ok: false, scan: null, checks: [], confidence: 0, missing: ["text layer (the PDF could not be read)"] };
  }
  const status = parse.ok ? "extracted" : "failed";
  try {
    await prisma.document.update({ where: { id: documentId }, data: { extractionStatus: status, extractionConfidence: String(parse.confidence) } });
  } catch (e) {
    console.error("uploadDexaReport: status update failed", e);
  }

  return { ok: true, documentId, parse };
}

/**
 * Remove an uploaded report that nothing references yet (row and file).
 * Refused while a scan or metabolic test points at it — delete the scan instead
 * (that path removes the document too).
 */
export async function discardDocument(id: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const doc = await prisma.document.findFirst({
    where: { id, userId: user.id },
    include: { _count: { select: { bodyCompScans: true, metabolicTests: true, ecgRecordings: true } } },
  });
  if (!doc) return { ok: true };
  if (doc._count.bodyCompScans > 0 || doc._count.metabolicTests > 0) {
    return { ok: false, error: "A saved scan references this report. Delete the scan to remove it." };
  }
  if (doc._count.ecgRecordings > 0) {
    return { ok: false, error: "A saved ECG recording references this report. Delete the recording to remove it." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.document.delete({ where: { id: doc.id } });
      await tx.auditLog.create({
        data: { userId: user.id, entityType: "Document", entityId: doc.id, field: "discard", oldValue: `${doc.kind} ${doc.extractionStatus}` },
      });
    });
  } catch (e) {
    console.error("discardDocument failed", e);
    return { ok: false, error: "Could not discard the report." };
  }
  // File after commit: a failed unlink leaves an orphan file, never a dangling row.
  await deleteDocumentFile(doc.filePath).catch((e) => console.error("discardDocument: unlink failed", e));

  revalidatePath("/body");
  return { ok: true };
}
