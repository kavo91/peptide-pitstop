"use server";

/**
 * ECG import. One step: hand it the PDFs Garmin Connect exported and they are
 * read and saved. There is no review screen and no form — every field on this
 * record is printed on the report, so asking a person to retype any of it would
 * only be a chance to get it wrong.
 *
 * Garmin publishes no ECG API (the watch exposes nothing and `/ecg-service/*`
 * 404s), so the PDF export is the only way this data leaves Garmin Connect.
 *
 * What the import deliberately does NOT read: the patient name, date of birth,
 * age and sex printed across the top of the page. The parser reads by column so
 * they cannot leak into a value, and there is nowhere to put them if they did.
 */

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { encryptField } from "@/lib/crypto/fieldEncryption";
import { DocumentValidationError, MAX_DOCUMENT_BYTES, deleteDocumentFile, saveDocumentFile } from "@/lib/documents";
import { sweepOrphanDocuments } from "@/lib/document-sweep";
import { extractEcgPdf } from "@/lib/ecg-pdf";
import { localTimeKey, parseEcgReport, type EcgReport } from "@/lib/ecg-parse-core";
import { dayKeyInTz, isValidTimeZone, zonedWallClockToInstant } from "@/lib/tz-day";

/** One upload's outcome. `file` is echoed back for the results list only — it is never stored. */
export interface EcgImportOutcome {
  file: string;
  status: "imported" | "updated" | "duplicate" | "failed";
  message: string;
  recordedAtIso?: string;
  result?: string;
  avgHeartRateBpm?: number | null;
  missing?: string[];
}

export interface EcgImportResult { ok: boolean; error?: string; outcomes: EcgImportOutcome[] }

/** More than this in one go is a mistake, not a batch. */
const MAX_FILES = 25;

function isBlobLike(v: unknown): v is Blob {
  return typeof v === "object" && v != null && typeof (v as Blob).arrayBuffer === "function" && typeof (v as Blob).size === "number";
}

/** A short, safe label for the results list. Never persisted and never used as a path. */
function displayName(v: unknown, index: number): string {
  const raw = typeof (v as File)?.name === "string" ? (v as File).name : "";
  // Strip control characters so a crafted filename cannot rewrite the line it is printed on.
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) return `File ${index + 1}`;
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}…` : cleaned;
}

/** Report fields → row columns. Every clinical value is encrypted at rest. */
function rowData(report: EcgReport, recordedAt: Date, tz: string, sourceHash: string) {
  const waveform = report.waveform;
  return {
    recordedAt,
    recordedLocalKey: localTimeKey(report.recordedAtLocal),
    localDay: dayKeyInTz(recordedAt, tz),
    tz,
    result: encryptField(report.result)!,
    avgHeartRateBpm: report.avgHeartRateBpm == null ? null : encryptField(String(report.avgHeartRateBpm)),
    // Verbatim, "--" included: see EcgReport.symptoms for why the printed
    // "none" must not be folded into "we did not read it".
    symptoms: report.symptoms ? encryptField(report.symptoms) : null,
    interpretation: report.interpretation ? encryptField(report.interpretation) : null,
    leadNote: report.leadNote,
    durationSec: report.durationSec,
    paperSpeedMmS: report.paperSpeedMmS == null ? null : String(report.paperSpeedMmS),
    gainMmMv: report.gainMmMv == null ? null : String(report.gainMmMv),
    sampleRateHz: report.sampleRateHz == null ? null : Math.round(report.sampleRateHz),
    deviceModel: report.deviceModel,
    deviceSoftware: report.deviceSoftware,
    ecgAppVersion: report.ecgAppVersion,
    connectWebVersion: report.connectWebVersion,
    pdfTemplateVersion: report.pdfTemplateVersion,
    backendVersion: report.backendVersion,
    waveformJson: waveform ? encryptField(JSON.stringify(waveform)) : null,
    waveformPoints: waveform?.points ?? null,
    sourceHash,
  };
}

/**
 * Import one or more Garmin ECG PDFs.
 *
 * Each file is independent: one unreadable report does not stop the rest, and
 * every file gets its own line in the result.
 *
 * A recording is identified by WHEN IT WAS RECORDED — the in-document
 * timestamp, never the download time in the filename. Importing the same
 * recording twice refreshes the stored row instead of creating a second one, so
 * re-uploading a whole export folder is always safe.
 */
export async function importEcgReports(formData: FormData): Promise<EcgImportResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in.", outcomes: [] };

  const tzRaw = formData.get("tz");
  const tz = typeof tzRaw === "string" && isValidTimeZone(tzRaw)
    ? tzRaw
    : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  // `File` rather than `Blob` so the narrowing is a subtype of FormDataEntryValue;
  // only `.name` is read off it beyond the Blob surface, and only for the label.
  const files = formData.getAll("files").filter((v): v is File => isBlobLike(v));
  if (files.length === 0) return { ok: false, error: "Choose at least one ECG PDF.", outcomes: [] };
  if (files.length > MAX_FILES) return { ok: false, error: `Import at most ${MAX_FILES} reports at a time.`, outcomes: [] };

  await sweepOrphanDocuments(user.id).catch((e) => console.error("importEcgReports: orphan sweep failed", e));

  // Sequential on purpose: pdf.js is CPU-bound, and 25 concurrent extractions
  // would starve the rest of the request handler on a small box.
  const outcomes: EcgImportOutcome[] = [];
  for (const [index, file] of files.entries()) {
    const name = displayName(file, index);
    try {
      outcomes.push(await importOne(user.id, tz, file, name));
    } catch (e) {
      console.error("importEcgReports: unexpected failure", e);
      outcomes.push({ file: name, status: "failed", message: "Something went wrong reading this report." });
    }
  }

  if (outcomes.some((o) => o.status === "imported" || o.status === "updated")) {
    revalidatePath("/journal");
    revalidatePath("/journal/ecg");
  }
  return { ok: true, outcomes };
}

async function importOne(userId: string, tz: string, file: Blob, name: string): Promise<EcgImportOutcome> {
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { file: name, status: "failed", message: "This file is larger than 10 MB." };
  }
  const buffer = Buffer.from(new Uint8Array(await file.arrayBuffer()));
  const sourceHash = createHash("sha256").update(buffer).digest("hex");

  // The cheapest duplicate check there is: this exact file, already imported.
  const sameFile = await prisma.ecgRecording.findFirst({ where: { userId, sourceHash }, select: { recordedAt: true } });
  if (sameFile) {
    return { file: name, status: "duplicate", message: "Already imported.", recordedAtIso: sameFile.recordedAt.toISOString() };
  }

  // Parse BEFORE storing anything, so an unreadable upload leaves no trace.
  let parsed;
  try {
    parsed = parseEcgReport(await extractEcgPdf(buffer));
  } catch (e) {
    console.error("importEcgReports: extraction failed", e);
    return { file: name, status: "failed", message: "This PDF could not be read." };
  }
  if (!parsed.ok || !parsed.report) {
    // A file with nothing recognisable in it is simply the wrong file, and
    // listing all ten fields it lacks says less than the plain sentence. The
    // list is worth printing only when the report was PARTLY readable — that is
    // the case where a template change is the likely cause.
    const partial = parsed.confidence > 0 && parsed.missing.length > 0;
    const what = partial ? ` Could not find: ${parsed.missing.join(", ")}.` : "";
    return { file: name, status: "failed", message: `This does not look like a Garmin ECG report.${what}`, missing: parsed.missing };
  }
  const report = parsed.report;
  const recordedAt = zonedWallClockToInstant(report.recordedAtLocal, tz);

  const recordedLocalKey = localTimeKey(report.recordedAtLocal);
  const existing = await prisma.ecgRecording.findUnique({
    where: { userId_recordedLocalKey: { userId, recordedLocalKey } },
    select: { id: true, waveformPoints: true, durationSec: true, document: { select: { id: true, filePath: true } } },
  });

  // The printed time is minute-precision, so two DIFFERENT recordings in one
  // minute would collide on the key. That is all but impossible on this device
  // — a recording is thirty seconds plus the taps around it — but overwriting a
  // stored recording with a different one would be silent data loss, so a
  // materially different trace at the same printed time is refused rather than
  // merged. A re-download of the same recording is not affected: its trace
  // matches, so it refreshes.
  const incomingPoints = report.waveform?.points ?? null;
  if (existing && existing.waveformPoints != null && incomingPoints != null) {
    const drift = Math.abs(existing.waveformPoints - incomingPoints) / existing.waveformPoints;
    if (drift > 0.05) {
      return {
        file: name,
        status: "failed",
        message: "A different recording is already stored at this time. Delete that one first if this should replace it.",
        recordedAtIso: recordedAt.toISOString(),
      };
    }
  }

  // The file is written before its `Document` row exists. Every error path below
  // unlinks it, so the only way one is left behind is the process dying in
  // between — and the orphan sweep looks for unreferenced ROWS, so it would not
  // find that file. A stray 130 KB PDF on the data volume is the accepted cost;
  // the alternative is a row pointing at a file that may not have been written.
  let saved: { id: string; filePath: string };
  try {
    saved = await saveDocumentFile(userId, buffer, "pdf");
  } catch (e) {
    if (e instanceof DocumentValidationError) return { file: name, status: "failed", message: e.message };
    console.error("importEcgReports: save failed", e);
    return { file: name, status: "failed", message: "Could not store the file." };
  }

  const data = rowData(report, recordedAt, tz, sourceHash);
  try {
    await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          userId,
          kind: "ecg_report",
          filePath: saved.filePath,
          mime: "application/pdf",
          // "extracted" means every expected field was found; a partial read is
          // still a real import, so it is recorded as read-with-gaps.
          extractionStatus: parsed.missing.length === 0 ? "extracted" : "confirmed",
          extractionConfidence: String(parsed.confidence),
        },
      });
      if (existing) {
        await tx.ecgRecording.update({ where: { id: existing.id }, data: { ...data, documentId: doc.id } });
        // Only after the row points at the new upload: a superseded document row
        // must never be removed while anything still references it.
        if (existing.document) await tx.document.delete({ where: { id: existing.document.id } });
        await tx.auditLog.create({
          data: { userId, entityType: "EcgRecording", entityId: existing.id, field: "reimport", newValue: `${recordedAt.toISOString()} ${sourceHash.slice(0, 12)}` },
        });
      } else {
        const created = await tx.ecgRecording.create({ data: { ...data, userId, documentId: doc.id } });
        await tx.auditLog.create({
          data: { userId, entityType: "EcgRecording", entityId: created.id, field: "import", newValue: `${recordedAt.toISOString()} ${sourceHash.slice(0, 12)}` },
        });
      }
    });
  } catch (e) {
    await deleteDocumentFile(saved.filePath).catch(() => undefined);
    // Two imports of one recording racing each other: the loser's insert trips
    // the unique key. That is the duplicate case, not a storage failure, and
    // saying "could not save" about a recording that IS saved would be wrong.
    if (typeof (e as { code?: unknown })?.code === "string" && (e as { code: string }).code === "P2002") {
      return { file: name, status: "duplicate", message: "Already imported.", recordedAtIso: recordedAt.toISOString() };
    }
    console.error("importEcgReports: write failed", e);
    return { file: name, status: "failed", message: "Could not save this recording." };
  }

  // File after commit: a failed unlink leaves an orphan file, never a dangling row.
  if (existing?.document) {
    await deleteDocumentFile(existing.document.filePath).catch((e) => console.error("importEcgReports: stale unlink failed", e));
  }

  return {
    file: name,
    status: existing ? "updated" : "imported",
    message: existing ? "Refreshed the recording already stored for this time." : "Imported.",
    recordedAtIso: recordedAt.toISOString(),
    result: report.result,
    avgHeartRateBpm: report.avgHeartRateBpm,
    missing: parsed.missing,
  };
}

/**
 * Delete one imported recording, its stored PDF and its `Document` row.
 * The trace is in the row and the report is in the file, so both go together.
 */
export async function deleteEcgRecording(id: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const rec = await prisma.ecgRecording.findFirst({
    where: { id, userId: user.id },
    select: { id: true, recordedAt: true, document: { select: { id: true, filePath: true } } },
  });
  if (!rec) return { ok: true };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.ecgRecording.delete({ where: { id: rec.id } });
      if (rec.document) await tx.document.delete({ where: { id: rec.document.id } });
      await tx.auditLog.create({
        data: { userId: user.id, entityType: "EcgRecording", entityId: rec.id, field: "delete", oldValue: rec.recordedAt.toISOString() },
      });
    });
  } catch (e) {
    console.error("deleteEcgRecording failed", e);
    return { ok: false, error: "Could not delete this recording." };
  }
  if (rec.document) await deleteDocumentFile(rec.document.filePath).catch((e) => console.error("deleteEcgRecording: unlink failed", e));

  revalidatePath("/journal");
  revalidatePath("/journal/ecg");
  return { ok: true };
}
