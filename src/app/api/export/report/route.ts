import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { decryptField } from "@/lib/crypto/fieldEncryption";
import { deserializeSideEffects } from "@/lib/side-effects";
import { brandName } from "@/lib/design";
import {
  buildReportPdf,
  type ReportData,
  type ReportDoseRow,
  type ReportSideEffect,
  type ReportLabPanel,
  type ReportWeightPoint,
} from "@/lib/pdf/report";

/**
 * GET /api/export/report?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Owner-scoped "doctor report" PDF of the current user's data over a date range.
 * Authenticated by the session cookie (the browser sends it on the download link);
 * not logged in -> 401. Default range = last 90 days; bad/missing params are
 * ignored and the default applies.
 *
 * All encrypted columns (notes, sideEffects, lab value, panel notes) are decrypted
 * server-side here -- ciphertext NEVER reaches the PDF builder, which is a pure
 * renderer. pdfkit is Node-only -> the route runs on the Node runtime.
 *
 * Responds `application/pdf` with a `peptide-report-YYYY-MM-DD.pdf` attachment.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 90;

/** Container-local YYYY-MM-DD for the download filename. */
function localDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parse a YYYY-MM-DD param to a Date (local midnight), or null on bad input. */
function parseDateParam(raw: string | null): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d, 0, 0, 0, 0);
  // Reject overflow (e.g. 2026-02-31 rolling into March) and non-finite dates.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/** Resolve [from, to] from query params, defaulting to the last 90 days. */
function resolveRange(req: NextRequest): { from: Date; to: Date } {
  const sp = req.nextUrl.searchParams;
  let from = parseDateParam(sp.get("from"));
  let to = parseDateParam(sp.get("to"));

  // Default `to` = end of today; default `from` = 90 days before `to`.
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (!to) to = endOfToday;
  else to = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999); // inclusive end-of-day
  if (!from) from = new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);

  // If reversed, swap so the query is always valid.
  if (from.getTime() > to.getTime()) [from, to] = [to, from];
  return { from, to };
}

/** Coerce a Prisma Decimal/number/string into a finite number, else null. */
function toNum(v: { toString(): string } | number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : null;
}

/** Decimal (or anything stringifiable) -> string, preserving null. */
function decStr(v: { toString(): string } | null | undefined): string | null {
  return v == null ? null : v.toString();
}

async function buildReportData(
  userId: string,
  ownerEmail: string,
  hydrationTargetMl: number | null,
  from: Date,
  to: Date,
): Promise<ReportData> {
  // -- Doses (reuse the CSV route's include shape) --
  const doseLogs = await prisma.doseLog.findMany({
    where: { userId, takenAt: { gte: from, lte: to } },
    orderBy: { takenAt: "asc" },
    include: {
      preparation: { include: { vial: { include: { peptide: true } } } },
      // Oral doses have no preparation — resolve the peptide via the protocol.
      protocol: { include: { peptide: true } },
    },
  });
  const doses: ReportDoseRow[] = doseLogs.map((d) => ({
    takenAt: d.takenAt,
    peptide: d.preparation?.vial?.peptide?.name ?? d.protocol?.peptide?.name ?? null,
    // The CSV exports doseMcg + doseInputUnit; mirror that here.
    doseValue: decStr(d.doseMcg),
    doseUnit: d.doseInputUnit,
    site: d.injectionSite,
    deltaMinutes: d.deltaMinutes,
  }));

  // -- Journal (side-effects + wellness aggregates) --
  const entries = await prisma.journalEntry.findMany({
    where: { userId, date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
  });

  const sideEffects: ReportSideEffect[] = [];
  const weight: ReportWeightPoint[] = [];
  const calorieVals: number[] = [];
  const proteinVals: number[] = [];
  const waterVals: number[] = [];

  for (const e of entries) {
    // Decrypt then deserialize side-effects (back-compat over all stored shapes).
    for (const se of deserializeSideEffects(decryptField(e.sideEffects))) {
      sideEffects.push({ symptom: se.symptom, severity: se.severity });
    }
    const wv = toNum(e.weight);
    if (wv != null) weight.push({ date: e.date, value: wv, unit: e.weightUnit ?? null });
    if (e.calories != null) calorieVals.push(e.calories);
    const pg = toNum(e.proteinG);
    if (pg != null) proteinVals.push(pg);
    if (e.waterMl != null) waterVals.push(e.waterMl);
  }

  const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  // -- Labs: the 3 MOST RECENT panels regardless of the report date range
  //    (bloodwork is infrequent; the report shows "your last 3 bloodworks" as a
  //    biomarker × date comparison). Fetch the 3 latest panel ids, then their rows.
  const recentPanels = await prisma.labPanel.findMany({
    where: { userId },
    orderBy: { collectedDate: "desc" },
    take: 3,
    select: { id: true },
  });
  const labResults = await prisma.labResult.findMany({
    where: { labPanelId: { in: recentPanels.map((p) => p.id) } },
    orderBy: [{ labPanel: { collectedDate: "desc" } }, { biomarker: { name: "asc" } }],
    include: { biomarker: true, labPanel: true },
  });
  const panelMap = new Map<string, ReportLabPanel>();
  for (const r of labResults) {
    const p = panelMap.get(r.labPanelId) ?? {
      collectedDate: r.labPanel.collectedDate,
      source: r.labPanel.labSource ?? null,
      rows: [],
    };
    p.rows.push({
      name: r.biomarker.name,
      value: decryptField(r.value),
      unit: r.unit ?? null,
      referenceLow: decStr(r.referenceLow),
      referenceHigh: decStr(r.referenceHigh),
      flag: r.flag ?? null,
    });
    panelMap.set(r.labPanelId, p);
  }
  const labs = [...panelMap.values()].sort((a, b) => a.collectedDate.getTime() - b.collectedDate.getTime());

  return {
    brand: brandName(),
    ownerEmail,
    generatedAt: new Date(),
    from,
    to,
    doses,
    sideEffects,
    wellness: {
      weight,
      avgCalories: avg(calorieVals),
      avgProteinG: avg(proteinVals),
      avgWaterMl: avg(waterVals),
      hydrationTargetMl,
    },
    labs,
  };
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { from, to } = resolveRange(req);
    const data = await buildReportData(user.id, user.email, user.hydrationTargetMl ?? null, from, to);
    const pdf = await buildReportPdf(data);
    return new NextResponse(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="peptide-report-${localDateStr()}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[export/report] error", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
