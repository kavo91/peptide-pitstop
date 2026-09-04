import "server-only";
/**
 * Read model for imported ECG recordings.
 *
 * Everything clinical is encrypted at rest, so it is decrypted here, at read
 * time, and never queried on. The waveform is the largest field by far and is
 * only fetched for the one recording actually being drawn — the history list
 * asks for `waveformPoints` instead, which answers "does this one have a trace?"
 * without decrypting thousands of samples.
 */
import { prisma } from "@/lib/db";
import { decryptField } from "@/lib/crypto/fieldEncryption";
import type { EcgWaveform } from "@/lib/ecg-parse-core";

export interface EcgRecordingSummary {
  id: string;
  recordedAt: Date;
  localDay: string;
  tz: string;
  /** Garmin's classification, verbatim. */
  result: string;
  avgHeartRateBpm: number | null;
  /** The symptoms cell verbatim, "--" included; null only when it was not read. Render with `symptomsLabel`. */
  symptoms: string | null;
  interpretation: string | null;
  leadNote: string | null;
  durationSec: number | null;
  paperSpeedMmS: number | null;
  gainMmMv: number | null;
  sampleRateHz: number | null;
  deviceModel: string | null;
  deviceSoftware: string | null;
  pdfTemplateVersion: string | null;
  hasWaveform: boolean;
  documentId: string | null;
}

export interface EcgRecordingDetail extends EcgRecordingSummary {
  waveform: EcgWaveform | null;
}

const SUMMARY_SELECT = {
  id: true,
  recordedAt: true,
  localDay: true,
  tz: true,
  result: true,
  avgHeartRateBpm: true,
  symptoms: true,
  interpretation: true,
  leadNote: true,
  durationSec: true,
  paperSpeedMmS: true,
  gainMmMv: true,
  sampleRateHz: true,
  deviceModel: true,
  deviceSoftware: true,
  pdfTemplateVersion: true,
  waveformPoints: true,
  documentId: true,
} as const;

type SummaryRow = {
  [K in keyof typeof SUMMARY_SELECT]: K extends "recordedAt" ? Date
    : K extends "id" | "localDay" | "tz" | "result" ? string
    : K extends "durationSec" | "sampleRateHz" | "waveformPoints" ? number | null
    : K extends "paperSpeedMmS" | "gainMmMv" ? { toString(): string } | null
    : string | null;
};

/**
 * `decryptField` THROWS on a key it cannot use (a rotated `PT_FIELD_KEY`, a tag
 * mismatch) rather than returning null. One such row would take the whole
 * wellness page down with it, so every read here goes through this: the row
 * still lists, with the unreadable value shown as unreadable.
 */
function safeDecrypt(v: string | null): string | null {
  if (v == null) return null;
  try {
    return decryptField(v);
  } catch {
    return null;
  }
}

const toNum = (v: { toString(): string } | null): number | null => {
  if (v == null) return null;
  const n = Number(v.toString());
  return Number.isFinite(n) ? n : null;
};

const decNum = (v: string | null): number | null => {
  const plain = safeDecrypt(v);
  if (plain == null || plain === "") return null;
  const n = Number(plain);
  return Number.isFinite(n) ? n : null;
};

function toSummary(row: SummaryRow): EcgRecordingSummary {
  return {
    id: row.id,
    recordedAt: row.recordedAt,
    localDay: row.localDay,
    tz: row.tz,
    // A row cannot exist without a result, but a key rotation that cannot
    // decrypt one must not crash the page — it shows as unreadable instead.
    result: safeDecrypt(row.result) || "Unreadable",
    avgHeartRateBpm: decNum(row.avgHeartRateBpm),
    symptoms: safeDecrypt(row.symptoms) || null,
    interpretation: safeDecrypt(row.interpretation) || null,
    leadNote: row.leadNote,
    durationSec: row.durationSec,
    paperSpeedMmS: toNum(row.paperSpeedMmS),
    gainMmMv: toNum(row.gainMmMv),
    sampleRateHz: row.sampleRateHz,
    deviceModel: row.deviceModel,
    deviceSoftware: row.deviceSoftware,
    pdfTemplateVersion: row.pdfTemplateVersion,
    hasWaveform: (row.waveformPoints ?? 0) > 0,
    documentId: row.documentId,
  };
}

/** Stored samples back into a waveform; a value that will not parse is treated as no trace. */
function parseWaveform(stored: string | null): EcgWaveform | null {
  const plain = safeDecrypt(stored);
  if (!plain) return null;
  try {
    const w = JSON.parse(plain) as EcgWaveform;
    return Array.isArray(w?.strips) && w.strips.length > 0 ? w : null;
  } catch {
    return null;
  }
}

/** The most recent recordings, newest first, without their traces. */
export async function getEcgHistory(userId: string, take = 20): Promise<EcgRecordingSummary[]> {
  const rows = await prisma.ecgRecording.findMany({
    where: { userId },
    orderBy: { recordedAt: "desc" },
    take,
    select: SUMMARY_SELECT,
  });
  return rows.map(toSummary);
}

export async function countEcgRecordings(userId: string): Promise<number> {
  return prisma.ecgRecording.count({ where: { userId } });
}

/** The newest recording WITH its trace — what the wellness card draws. */
export async function getLatestEcg(userId: string): Promise<EcgRecordingDetail | null> {
  const row = await prisma.ecgRecording.findFirst({
    where: { userId },
    orderBy: { recordedAt: "desc" },
    select: { ...SUMMARY_SELECT, waveformJson: true },
  });
  if (!row) return null;
  return { ...toSummary(row), waveform: parseWaveform(row.waveformJson) };
}

/** One recording by id, with its trace. Scoped to the owner. */
export async function getEcgRecording(userId: string, id: string): Promise<EcgRecordingDetail | null> {
  const row = await prisma.ecgRecording.findFirst({
    where: { id, userId },
    select: { ...SUMMARY_SELECT, waveformJson: true },
  });
  if (!row) return null;
  return { ...toSummary(row), waveform: parseWaveform(row.waveformJson) };
}

export interface EcgOverview {
  latest: EcgRecordingDetail | null;
  history: EcgRecordingSummary[];
  total: number;
}

/** Everything the wellness page's ECG section needs, in one round of queries. */
export async function getEcgOverview(userId: string, historyTake = 6): Promise<EcgOverview> {
  const [latest, history, total] = await Promise.all([
    getLatestEcg(userId),
    getEcgHistory(userId, historyTake),
    countEcgRecordings(userId),
  ]);
  return { latest, history, total };
}
