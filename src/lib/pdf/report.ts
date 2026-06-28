/**
 * PDF "doctor report" builder — pure rendering, NO I/O, no Prisma, no crypto.
 *
 * The caller (the /api/export/report route) fetches + DECRYPTS all data server-side
 * and hands this builder a plain `ReportData` object. That keeps this module:
 *   - unit-testable without a DB or env (the test passes a literal ReportData), and
 *   - guaranteed never to touch ciphertext — only decrypted plaintext arrives here.
 *
 * Fonts: ONLY pdfkit's built-in standard fonts (Helvetica / Helvetica-Bold), whose
 * AFM metrics are bundled with pdfkit. No external font files → safe on the Alpine
 * production image (no system-font dependency).
 */
import PDFDocument from "pdfkit";

// ── Public data shape ───────────────────────────────────────────────────────

export interface ReportDoseRow {
  /** When the dose was taken. */
  takenAt: Date;
  /** Peptide display name, or null if unresolved. */
  peptide: string | null;
  /** Dose value in the input unit (already a number/string), or null. */
  doseValue: string | number | null;
  /** The dose unit (e.g. "mcg", "mg", "units"). */
  doseUnit: string | null;
  /** Injection site, or null (oral / unrecorded). */
  site: string | null;
  /** Minutes early(−)/late(+) vs the scheduled time, or null when unscheduled. */
  deltaMinutes: number | null;
}

export interface ReportSideEffect {
  symptom: string;
  /** "mild" | "moderate" | "severe" | null. */
  severity: string | null;
}

export interface ReportWeightPoint {
  date: Date;
  /** Weight in `unit`. */
  value: number;
  unit: string | null;
}

export interface ReportWellness {
  weight: ReportWeightPoint[];
  /** Average daily calories over the range (kcal), or null. */
  avgCalories: number | null;
  /** Average daily protein over the range (g), or null. */
  avgProteinG: number | null;
  /** Average daily water over the range (mL), or null. */
  avgWaterMl: number | null;
  /** Daily hydration target (mL) from the user profile, or null. */
  hydrationTargetMl: number | null;
}

export interface ReportLabRow {
  name: string;
  /** Decrypted value (string to allow "<3", ">90", numeric). */
  value: string | null;
  unit: string | null;
  referenceLow: string | number | null;
  referenceHigh: string | number | null;
  flag: string | null;
}

export interface ReportLabPanel {
  collectedDate: Date;
  source: string | null;
  rows: ReportLabRow[];
}

export interface ReportData {
  /** User-facing brand name for the active design pack (threaded from the route). */
  brand: string;
  ownerEmail: string;
  generatedAt: Date;
  from: Date;
  to: Date;
  doses: ReportDoseRow[];
  /** All side-effect entries across the range (already deserialized + decrypted). */
  sideEffects: ReportSideEffect[];
  wellness: ReportWellness;
  labs: ReportLabPanel[];
}

// ── Formatting helpers ──────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDateTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${fmtDate(d)} ${hh}:${mm}`;
}

/** "+12m" / "−5m" / "on time" / "—". */
function fmtDelta(min: number | null): string {
  if (min == null) return "—";
  if (min === 0) return "on time";
  const sign = min > 0 ? "+" : "−";
  return `${sign}${Math.abs(min)}m`;
}

function fmtDose(value: string | number | null, unit: string | null): string {
  if (value == null) return "—";
  const v = typeof value === "number" ? String(value) : value;
  return unit ? `${v} ${unit}` : v;
}

function fmtRef(low: string | number | null, high: string | number | null): string {
  const l = low == null ? "" : String(low);
  const h = high == null ? "" : String(high);
  if (!l && !h) return "—";
  if (l && h) return `${l}–${h}`;
  return l ? `≥ ${l}` : `≤ ${h}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * pdfkit's built-in Helvetica uses WinAnsi encoding, which lacks many Unicode
 * glyphs (arrows, ≤/≥, the minus-sign U+2212, Δ, …). Writing them produces
 * garbage. `safe()` maps the common offenders to ASCII and replaces any other
 * out-of-range codepoint (>0xFF, e.g. emoji or CJK in user-entered data) with
 * "?", so the report can never render mojibake regardless of input.
 */
const UNICODE_MAP: Record<string, string> = {
  "→": "to", "⟶": "to", "←": "<-", "↑": "^", "↓": "v", "⇒": "=>", "⟹": "=>",
  "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~", "−": "-",
  "–": "-", "—": "-", "―": "-", "‐": "-", "‑": "-", "‒": "-",
  "•": "*", "·": "*", "…": "...", "′": "'", "″": '"',
  "“": '"', "”": '"', "„": '"', "‘": "'", "’": "'", "‚": "'",
  "Δ": "delta", "μ": "u", "Ω": "ohm",
};
export function safe(s: string): string {
  let out = "";
  for (const ch of s) {
    const mapped = UNICODE_MAP[ch];
    if (mapped !== undefined) { out += mapped; continue; }
    out += (ch.codePointAt(0) ?? 0) <= 0xff ? ch : "?";
  }
  return out;
}

// ── Aggregation ─────────────────────────────────────────────────────────────

/** Aggregate side-effect entries → "Nausea ×4 (moderate)" style summary lines. */
export function summariseSideEffects(entries: ReportSideEffect[]): string[] {
  const counts = new Map<string, { count: number; severities: Map<string, number> }>();
  for (const e of entries) {
    const key = e.symptom.trim();
    if (!key) continue;
    const rec = counts.get(key) ?? { count: 0, severities: new Map() };
    rec.count += 1;
    if (e.severity) rec.severities.set(e.severity, (rec.severities.get(e.severity) ?? 0) + 1);
    counts.set(key, rec);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([symptom, rec]) => {
      // Most common severity, if any were recorded.
      let topSeverity: string | null = null;
      let topN = 0;
      for (const [sev, n] of rec.severities) {
        if (n > topN) {
          topN = n;
          topSeverity = sev;
        }
      }
      const sevSuffix = topSeverity ? ` (${topSeverity})` : "";
      return `${symptom} ×${rec.count}${sevSuffix}`;
    });
}

/** Compact out-of-range marker appended to a comparison cell. Normal → "". */
function flagMark(flag: string | null): string {
  switch ((flag ?? "").toLowerCase()) {
    case "high": return " (H)";
    case "low": return " (L)";
    case "borderline": return " (B)";
    default: return "";
  }
}

export interface LabComparisonRow {
  name: string;
  unit: string;
  reference: string;
  /** One cell per date in `LabComparison.dates`; "—" when that panel lacks the marker. */
  cells: string[];
}
export interface LabComparison {
  /** The panel dates, MOST RECENT FIRST. */
  dates: Date[];
  /** Lab source per date (aligned to `dates`). */
  sources: (string | null)[];
  rows: LabComparisonRow[];
}

/**
 * Pivot the most-recent `limit` lab panels into a biomarker × date comparison:
 * one row per biomarker (union across the panels, alphabetical), one column per
 * panel date (most recent first). Unit + reference come from the most-recent
 * panel that contains the marker. Each cell is "value (flag)" or "—" if absent.
 */
export function buildLabComparison(labs: ReportLabPanel[], limit = 3): LabComparison {
  const panels = [...labs]
    .sort((a, b) => b.collectedDate.getTime() - a.collectedDate.getTime())
    .slice(0, limit);
  const dates = panels.map((p) => p.collectedDate);
  const sources = panels.map((p) => p.source);

  const markers = new Map<string, { unit: string; reference: string; cells: (string | undefined)[] }>();
  panels.forEach((panel, pi) => {
    for (const r of panel.rows) {
      let m = markers.get(r.name);
      if (!m) {
        // Panels are sorted newest-first, so the first sighting is the most recent.
        m = {
          unit: r.unit ?? "—",
          reference: fmtRef(r.referenceLow, r.referenceHigh),
          cells: new Array(panels.length).fill(undefined),
        };
        markers.set(r.name, m);
      }
      m.cells[pi] = r.value == null ? "—" : `${r.value}${flagMark(r.flag)}`;
    }
  });

  const rows: LabComparisonRow[] = [...markers.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, m]) => ({ name, unit: m.unit, reference: m.reference, cells: m.cells.map((c) => c ?? "—") }));

  return { dates, sources, rows };
}

// ── Layout primitives ───────────────────────────────────────────────────────

type Doc = PDFKit.PDFDocument;

const PAGE_MARGIN = 50;
const TEXT = "#1a1a1a";
const MUTED = "#666666";
const LINE = "#cccccc";
const ACCENT = "#2563eb";

function sectionHeading(doc: Doc, title: string): void {
  ensureSpace(doc, 40);
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(TEXT).text(title);
  const y = doc.y + 2;
  doc
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .lineWidth(0.5)
    .strokeColor(LINE)
    .stroke();
  doc.moveDown(0.5);
  doc.fillColor(TEXT);
}

function bodyText(doc: Doc, text: string): void {
  doc.font("Helvetica").fontSize(10).fillColor(TEXT).text(text);
}

function mutedText(doc: Doc, text: string): void {
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(text);
  doc.fillColor(TEXT);
}

/** Page-break before drawing if fewer than `needed` points remain. */
function ensureSpace(doc: Doc, needed: number): void {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
}

/**
 * Draw a simple fixed-column table. Columns are {label,width}; rows are string[].
 * Auto-paginates: repeats the header on each new page. Widths are in points and
 * should sum to ≤ the content width.
 */
function table(doc: Doc, columns: { label: string; width: number }[], rows: string[][]): void {
  const left = doc.page.margins.left;
  const rowH = 16;
  const headerH = 18;

  const drawHeader = (): void => {
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED);
    let x = left;
    for (const col of columns) {
      doc.text(col.label, x + 2, y + 4, { width: col.width - 4, ellipsis: true });
      x += col.width;
    }
    const lineY = y + headerH - 2;
    doc
      .moveTo(left, lineY)
      .lineTo(x, lineY)
      .lineWidth(0.5)
      .strokeColor(LINE)
      .stroke();
    doc.y = y + headerH;
    doc.fillColor(TEXT);
  };

  ensureSpace(doc, headerH + rowH);
  drawHeader();

  doc.font("Helvetica").fontSize(9).fillColor(TEXT);
  for (const row of rows) {
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      drawHeader();
      doc.font("Helvetica").fontSize(9).fillColor(TEXT);
    }
    const y = doc.y;
    let x = left;
    for (let i = 0; i < columns.length; i++) {
      doc.text(row[i] ?? "", x + 2, y + 3, { width: columns[i].width - 4, ellipsis: true });
      x += columns[i].width;
    }
    doc.y = y + rowH;
  }
  // Cells were drawn with explicit X; reset so the next flowing text() starts at
  // the left margin (otherwise headings/paragraphs inherit the last column's X).
  doc.x = left;
  doc.fillColor(TEXT);
}

/**
 * Tiny weight sparkline drawn with pdfkit lines. No-op for < 2 points.
 * Drawn inline at the current cursor; advances doc.y past it.
 */
function weightSparkline(doc: Doc, points: ReportWeightPoint[]): void {
  const pts = points.filter((p) => Number.isFinite(p.value));
  if (pts.length < 2) return;

  const left = doc.page.margins.left;
  const fullW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const yAxisW = 36; // left gutter for the weight (y) scale labels
  const plotLeft = left + yAxisW;
  const plotW = Math.min(fullW - yAxisW, 300);
  const h = 44;
  ensureSpace(doc, h + 18);
  const top = doc.y + 4;

  const sorted = [...pts].sort((a, b) => a.date.getTime() - b.date.getTime());
  const values = sorted.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const unit = sorted[sorted.length - 1].unit ?? "";
  const unitStr = unit ? " " + unit : "";
  const last = sorted.length - 1;

  const xFor = (i: number): number => plotLeft + (i / (sorted.length - 1)) * plotW;
  const yFor = (v: number): number => top + h - ((v - min) / span) * h;

  // Axes: y (weights) up the left edge of the plot, x (dates) along the bottom.
  doc.lineWidth(0.5).strokeColor(LINE);
  doc.moveTo(plotLeft, top).lineTo(plotLeft, top + h).lineTo(plotLeft + plotW, top + h).stroke();

  // Trend line + a dot at each weigh-in.
  doc.lineWidth(1).strokeColor(ACCENT);
  doc.moveTo(xFor(0), yFor(values[0]));
  for (let i = 1; i < sorted.length; i++) doc.lineTo(xFor(i), yFor(values[i]));
  doc.stroke();
  doc.fillColor(ACCENT);
  for (let i = 0; i < sorted.length; i++) doc.circle(xFor(i), yFor(values[i]), 1.4).fill();

  // Y-AXIS = weights: max at the top, min at the bottom, in the left gutter.
  doc.font("Helvetica").fontSize(7).fillColor(MUTED);
  doc.text(`${round1(max)}${unitStr}`, left, top - 3, { width: yAxisW - 4, align: "right" });
  doc.text(`${round1(min)}${unitStr}`, left, top + h - 4, { width: yAxisW - 4, align: "right" });

  // X-AXIS = dates only (no weights): start at the left, latest at the right.
  doc.text(fmtDate(sorted[0].date), plotLeft, top + h + 2, { width: plotW / 2 });
  doc.text(fmtDate(sorted[last].date), plotLeft + plotW / 2, top + h + 2, { width: plotW / 2, align: "right" });

  doc.y = top + h + 14;
  doc.x = left; // reset X (axis labels used explicit X) so following text flows from the margin
  doc.fillColor(TEXT).strokeColor(LINE);
}

// ── Section writers ─────────────────────────────────────────────────────────

function writeCover(doc: Doc, data: ReportData): void {
  doc.font("Helvetica-Bold").fontSize(22).fillColor(TEXT).text(`${data.brand} — Report`);
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10).fillColor(MUTED);
  doc.text(`Owner: ${data.ownerEmail}`);
  doc.text(`Generated: ${fmtDateTime(data.generatedAt)}`);
  doc.text(`Date range: ${fmtDate(data.from)} → ${fmtDate(data.to)}`);
  doc.fillColor(TEXT).moveDown(0.2);
}

function writeDoses(doc: Doc, data: ReportData): void {
  sectionHeading(doc, "Dose log");
  if (!data.doses.length) {
    mutedText(doc, "No doses in this range.");
    return;
  }
  const rows = data.doses.map((d) => [
    fmtDateTime(d.takenAt),
    d.peptide ?? "—",
    fmtDose(d.doseValue, d.doseUnit),
    d.site ?? "—",
    fmtDelta(d.deltaMinutes),
  ]);
  table(
    doc,
    [
      { label: "Date / time", width: 120 },
      { label: "Peptide", width: 130 },
      { label: "Dose", width: 90 },
      { label: "Site", width: 90 },
      { label: "Timing", width: 65 },
    ],
    rows,
  );
}

function writeSideEffects(doc: Doc, data: ReportData): void {
  sectionHeading(doc, "Side-effect summary");
  const lines = summariseSideEffects(data.sideEffects);
  if (!lines.length) {
    mutedText(doc, "No side-effects recorded in this range.");
    return;
  }
  doc.font("Helvetica").fontSize(10).fillColor(TEXT);
  for (const line of lines) {
    ensureSpace(doc, 14);
    doc.text(`• ${line}`);
  }
}

function writeWellness(doc: Doc, data: ReportData): void {
  sectionHeading(doc, "Wellness summary");
  const w = data.wellness;
  const weight = w.weight.filter((p) => Number.isFinite(p.value)).sort((a, b) => a.date.getTime() - b.date.getTime());

  let any = false;

  if (weight.length) {
    any = true;
    const latest = weight[weight.length - 1];
    const earliest = weight[0];
    const unit = latest.unit ?? "";
    const sameUnit = earliest.unit === latest.unit;
    const delta = sameUnit ? round1(latest.value - earliest.value) : null;
    const deltaStr =
      delta == null ? "" : delta === 0 ? " (no change)" : ` (${delta > 0 ? "+" : "−"}${Math.abs(delta)}${unit ? " " + unit : ""})`;
    bodyText(doc, `Latest weight: ${round1(latest.value)}${unit ? " " + unit : ""}${deltaStr}`);
    weightSparkline(doc, weight);
  }

  if (w.avgCalories != null) {
    any = true;
    bodyText(doc, `Average calories: ${Math.round(w.avgCalories)} kcal/day`);
  }
  if (w.avgProteinG != null) {
    any = true;
    bodyText(doc, `Average protein: ${round1(w.avgProteinG)} g/day`);
  }
  if (w.avgWaterMl != null) {
    any = true;
    const target = w.hydrationTargetMl;
    const vsTarget = target ? ` vs target ${target} mL (${Math.round((w.avgWaterMl / target) * 100)}%)` : "";
    bodyText(doc, `Average water: ${Math.round(w.avgWaterMl)} mL/day${vsTarget}`);
  } else if (w.hydrationTargetMl) {
    any = true;
    mutedText(doc, `Hydration target: ${w.hydrationTargetMl} mL/day (no water logged in range).`);
  }

  if (!any) mutedText(doc, "No wellness data in this range.");
}

function writeLabs(doc: Doc, data: ReportData): void {
  sectionHeading(doc, "Bloodwork — last 3 panels");
  const cmp = buildLabComparison(data.labs, 3);
  if (!cmp.rows.length) {
    mutedText(doc, "No bloodwork recorded.");
    return;
  }

  // Biomarker / Unit / Reference are fixed; each panel date gets a value column.
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const nameW = 138;
  const unitW = 48;
  const refW = 78;
  const dateW = Math.min(90, Math.floor((contentWidth - nameW - unitW - refW) / Math.max(1, cmp.dates.length)));
  const columns = [
    { label: "Biomarker", width: nameW },
    { label: "Unit", width: unitW },
    { label: "Reference", width: refW },
    ...cmp.dates.map((d) => ({ label: fmtDate(d), width: dateW })),
  ];
  const rows = cmp.rows.map((r) => [r.name, r.unit, r.reference, ...r.cells]);
  table(doc, columns, rows);

  // Legend + which lab each date column came from.
  doc.moveDown(0.3);
  mutedText(doc, "H = high, L = low, B = borderline (no marker = normal / unflagged)");
  mutedText(doc, "Sources — " + cmp.dates.map((d, i) => `${fmtDate(d)}: ${cmp.sources[i] ?? "—"}`).join("    "));
}

function writeFooter(doc: Doc, data: ReportData): void {
  doc.moveDown(1.2);
  ensureSpace(doc, 30);
  const y = doc.y;
  doc
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .lineWidth(0.5)
    .strokeColor(LINE)
    .stroke();
  doc.moveDown(0.4);
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(MUTED)
    .text(`Generated by ${data.brand} — for personal record sharing. Not medical advice.`, {
      align: "center",
    });
  doc.fillColor(TEXT);
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Build the doctor report PDF and resolve to a Buffer. Robust to empty sections.
 * Pure: no DB, no env, no crypto — give it a fully-resolved (decrypted) ReportData.
 */
export function buildReportPdf(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN, bufferPages: true });
      // Sanitise EVERY string written to the PDF (WinAnsi-only Helvetica) so no
      // call site can emit mojibake — covers helper output + raw user data alike.
      const rawText = doc.text.bind(doc);
      (doc as unknown as { text: (...a: unknown[]) => unknown }).text = (t: unknown, ...rest: unknown[]) =>
        rawText(typeof t === "string" ? safe(t) : (t as string), ...(rest as []));
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      writeCover(doc, data);
      writeDoses(doc, data);
      writeSideEffects(doc, data);
      writeWellness(doc, data);
      writeLabs(doc, data);
      writeFooter(doc, data);

      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
