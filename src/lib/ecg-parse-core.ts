/**
 * Pure parser for a Garmin ECG report (Connect phone-app PDF export).
 *
 * No pdf.js here and no I/O: `ecg-pdf.ts` does the extraction and hands this
 * module positioned text items plus the vector polylines the waveform is drawn
 * with. That keeps the parser testable from synthetic fixtures — a real ECG
 * report is personal health data and never enters either repo.
 *
 * TWO RULES GOVERN THIS FILE.
 *
 * 1. Garmin's words are printed, never re-judged. `result`, `interpretation`
 *    and `leadNote` come out verbatim. Nothing here decides what a trace means.
 *
 * 2. The identifying half of the page is deliberately not read. Patient name,
 *    date of birth, age and sex are all in the text layer and none of them has
 *    a field in `EcgReport` — same rule the DEXA importer follows. The parser
 *    reads BY COLUMN, so the name sharing a row with the title (and the date of
 *    birth sharing one with the recording time) cannot leak into a value.
 *
 * Layout key: `PDF Template 1.2.114`. A template change is what breaks this
 * parser, which is why the version is stored on every imported row.
 */

export interface PdfPoint { x: number; y: number }
export interface PdfTextItem { str: string; x: number; y: number; width: number; height: number }
/** What `extractEcgPdf` produces: text items and waveform polylines, page space. */
export interface EcgPdfContent { items: PdfTextItem[]; traces: PdfPoint[][] }

/** One printed 10-second strip, on its own uniform time grid. */
export interface EcgWaveformStrip {
  /** Milliseconds from the start of the recording to this strip's first sample. */
  t0Ms: number;
  /** Milliseconds between samples. */
  dtMs: number;
  /**
   * Microvolts against THIS strip's isoelectric median — each strip is drawn
   * about its own baseline on the page, exactly as a paper ECG is.
   *
   * `null` is a hole in the printed trace (the export lifts the pen over a
   * stretch it did not draw). It is kept as a gap so the line breaks there
   * instead of being bridged by a straight segment that was never recorded.
   */
  uv: (number | null)[];
}

export interface EcgWaveform {
  /** Sample rate of the trace AS DRAWN IN THE PDF (~128 Hz) — not the watch's 512 Hz. */
  drawnHz: number;
  durationMs: number;
  strips: EcgWaveformStrip[];
  points: number;
  /**
   * Candidate paths this refused to read as a strip. Never silently zero: a
   * dropped strip is ten seconds of the recording missing from the picture, so
   * the count is carried out and reported rather than swallowed.
   */
  droppedStrips: number;
}

/** Wall-clock parts as printed. The zone is the caller's to apply — the page carries none. */
export interface EcgLocalTime { year: number; month: number; day: number; hour: number; minute: number }

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/**
 * The printed wall clock as one sortable string, "YYYY-MM-DDTHH:mm".
 *
 * This is a recording's IDENTITY. The instant it resolves to depends on which
 * device imported it — the page states no zone — so two imports of one report
 * from two zones would look like two recordings if the instant were the key.
 */
export function localTimeKey(t: EcgLocalTime): string {
  return `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}T${pad(t.hour)}:${pad(t.minute)}`;
}

export interface EcgReport {
  /** Garmin's classification, verbatim (e.g. "Sinus Rhythm"). */
  result: string;
  avgHeartRateBpm: number | null;
  /**
   * The symptoms cell VERBATIM, including Garmin's "--" for none — null only
   * when the column was not read at all. Storing the printed "--" is what lets
   * a surface say "None reported" only when the report actually reported none;
   * folding it to null here would make "we did not read it" and "the report
   * said none" the same value, and one of those is a claim the report never made.
   */
  symptoms: string | null;
  /** Verbatim (e.g. "This ECG recording does not show signs of AFib."). */
  interpretation: string | null;
  leadNote: string | null;
  recordedAtRaw: string;
  recordedAtLocal: EcgLocalTime;
  durationSec: number | null;
  paperSpeedMmS: number | null;
  gainMmMv: number | null;
  sampleRateHz: number | null;
  deviceModel: string | null;
  deviceSoftware: string | null;
  ecgAppVersion: string | null;
  connectWebVersion: string | null;
  pdfTemplateVersion: string | null;
  backendVersion: string | null;
  waveform: EcgWaveform | null;
}

export interface EcgParseResult {
  /** True only when the report yielded both halves of its identity: a result and a recording time. */
  ok: boolean;
  report: EcgReport | null;
  /** Human-readable names of the fields that were not found. */
  missing: string[];
  /** 0–1, share of the expected fields that were read. */
  confidence: number;
}

/** Two text items within this many PDF units of each other are on one printed row. */
const ROW_TOLERANCE = 2;
/** PDF units per millimetre (72 dpi user space). */
const UNITS_PER_MM = 72 / 25.4;
/** Fallbacks when the footer's scale line is unreadable — the ECG standard. */
const DEFAULT_MM_PER_SEC = 25;
const DEFAULT_MM_PER_MV = 10;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

interface Cell { text: string; x: number; right: number; height: number }
interface Row { y: number; cells: Cell[] }

/**
 * Items grouped into printed rows, each row split into CELLS at the column gaps.
 *
 * The gap threshold is deliberately much wider than a word space: inside a cell
 * ("Average Heart Rate", "Sinus Rhythm") the runs sit ~2 units apart, while the
 * columns of this layout are 120+ units apart. Splitting on a word-sized gap
 * would shatter every label; not splitting at all would glue the patient's name
 * onto the report title.
 */
export function buildRows(items: PdfTextItem[]): Row[] {
  const groups: { y: number; items: PdfTextItem[] }[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const g = groups.find((r) => Math.abs(r.y - it.y) <= ROW_TOLERANCE);
    if (g) g.items.push(it);
    else groups.push({ y: it.y, items: [it] });
  }
  groups.sort((a, b) => b.y - a.y); // page space: larger y is higher on the page
  return groups.map((g) => {
    const sorted = [...g.items].sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    for (const it of sorted) {
      const prev = cells[cells.length - 1];
      const columnGap = Math.max(2.5 * (it.height || 10), 8);
      if (prev && it.x - prev.right <= columnGap) {
        const wordGap = Math.max(0.15 * (it.height || 10), 0.5);
        prev.text += it.x - prev.right > wordGap && !prev.text.endsWith(" ") && !it.str.startsWith(" ") ? ` ${it.str}` : it.str;
        prev.right = it.x + (it.width || 0);
        prev.height = Math.max(prev.height, it.height || 0);
      } else {
        cells.push({ text: it.str, x: it.x, right: it.x + (it.width || 0), height: it.height || 0 });
      }
    }
    return { y: g.y, cells: cells.map((c) => ({ ...c, text: c.text.replace(/\s+/g, " ").trim() })) };
  });
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The row directly above `row` on the page, or null when it is the topmost. */
function rowAbove(rows: Row[], row: Row): Row | null {
  let best: Row | null = null;
  for (const r of rows) if (r.y > row.y && (best == null || r.y < best.y)) best = r;
  return best;
}

/**
 * The labels this parser anchors on. A cell that IS one of these is a heading,
 * never the continuation of the value above it — which is the rule that stops a
 * wrapped-value walk from climbing out of its own block and into the next one.
 */
const COLUMN_LABELS = ["result", "average heart rate", "symptoms reported", "summary"];

/**
 * How far above a row another row may sit and still be its wrapped continuation.
 * A wrapped line sits a little over one line-height up; anything further is a
 * different block.
 */
function lineGapLimit(valueHeight: number): number {
  return 1.9 * Math.max(valueHeight, 7);
}

/**
 * The value printed above `label` in the same column.
 *
 * Garmin left-aligns a value with its label, so the column is matched on the
 * left edge. This is what keeps the read honest: a value is only accepted when
 * it sits under the label that names it, never because it was nearby in the text.
 *
 * Two rules beyond "the row above":
 *
 *   - A WRAPPED value is read whole. Garmin's longer summaries — the ones that
 *     name a finding — run onto a second printed line, and taking only the
 *     nearest row would store the tail of a sentence as the vendor's verbatim
 *     words. Aligned lines are collected upward and joined in page order.
 *   - The search is BOUNDED. Without a gap limit, a label whose value is
 *     missing silently adopts whatever is printed above it, however far up the
 *     page that is. Past the limit the value is reported missing instead.
 */
function valueUnderLabel(rows: Row[], label: string): string | null {
  const wanted = norm(label);
  for (const row of rows) {
    const cell = row.cells.find((c) => norm(c.text) === wanted);
    if (!cell) continue;

    const lines: string[] = [];
    let below = row;
    for (;;) {
      const above = rowAbove(rows, below);
      if (!above) break;
      const value = above.cells.find((c) => Math.abs(c.x - cell.x) <= 6);
      if (!value?.text) break;
      // A heading is never the continuation of the value above it.
      if (COLUMN_LABELS.includes(norm(value.text))) break;
      if (above.y - below.y > lineGapLimit(value.height)) break;
      lines.unshift(value.text);
      below = above;
    }
    if (lines.length > 0) return lines.join(" ");
  }
  return null;
}

/** Every cell on the page, flattened — for the free-text lines that carry no label. */
function allCells(rows: Row[]): Cell[] {
  return rows.flatMap((r) => r.cells);
}

function findCell(rows: Row[], test: RegExp): string | null {
  for (const c of allCells(rows)) if (test.test(c.text)) return c.text;
  return null;
}

/** "12 June 2024 @ 9:17 AM" → wall-clock parts. The "@" is what separates this
 *  from the date of birth and the download date, neither of which carries a time. */
export function parseRecordedAt(text: string): EcgLocalTime | null {
  const m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*@\s*(\d{1,2}):(\d{2})(?:\s*([AaPp])\.?[Mm]\.?)?$/.exec(text.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
  const year = Number(m[3]);
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  const meridiem = m[6]?.toLowerCase();
  if (meridiem === "p" && hour < 12) hour += 12;
  if (meridiem === "a" && hour === 12) hour = 0;
  if (!month || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return { year, month, day, hour, minute };
}

const num = (s: string | null | undefined): number | null => {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Median of a non-empty list. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * The printed strips turned into a time/voltage signal.
 *
 * Geometry only — nothing is smoothed, filtered or interpreted. The page is
 * drawn at a known paper speed and gain, so millimetres convert straight to
 * seconds and millivolts.
 *
 * Two things the page decides, not this function:
 *   - Vertical zero is EACH STRIP's own median sample. A strip is a separate
 *     row on the page with its own baseline; centring them all on one number
 *     would put two of the three a full page-row off scale.
 *   - Horizontal zero is the leftmost x any strip reaches — the shared page
 *     margin — so a strip whose trace starts late keeps that late start.
 *
 * Samples land on a uniform grid at the step the export actually used, and a
 * stretch it did not draw stays a hole (`null`) rather than a straight line.
 */
export function buildWaveform(traces: PdfPoint[][], mmPerSec: number, mmPerMv: number): EcgWaveform | null {
  const usable = traces.filter((t) => t.length >= 2);
  if (usable.length === 0) return null;
  const unitsPerSecond = mmPerSec * UNITS_PER_MM;
  const unitsPerMv = mmPerMv * UNITS_PER_MM;
  if (!(unitsPerSecond > 0) || !(unitsPerMv > 0)) return null;

  // Top strip first: on the page, higher y is earlier in the recording.
  const ordered = usable
    .map((pts) => [...pts].sort((a, b) => a.x - b.x))
    .sort((a, b) => median(b.map((p) => p.y)) - median(a.map((p) => p.y)));

  const x0 = Math.min(...ordered.map((pts) => pts[0]!.x));
  const spans = ordered.map((pts) => (pts[pts.length - 1]!.x - pts[0]!.x) / unitsPerSecond);
  const stripSpanSec = Math.max(1, Math.round(Math.max(...spans)));

  const strips: EcgWaveformStrip[] = [];
  let points = 0;
  let durationMs = 0;
  let dtMsOfGrid: number | null = null;
  let dropped = 0;

  ordered.forEach((pts, index) => {
    const steps: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const d = pts[i]!.x - pts[i - 1]!.x;
      if (d > 0) steps.push(d);
    }
    if (steps.length === 0) { dropped++; return; }
    const step = median(steps);
    if (!(step > 0)) { dropped++; return; }

    const startX = pts[0]!.x;
    const slots = Math.round((pts[pts.length - 1]!.x - startX) / step) + 1;
    // A strip is ~1300 samples; anything wildly larger means the step estimate
    // is wrong and the grid would be mostly holes, so it is refused outright.
    if (!Number.isFinite(slots) || slots < 2 || slots > 20000) { dropped++; return; }

    const baseline = median(pts.map((p) => p.y));
    const uv: (number | null)[] = new Array<number | null>(slots).fill(null);
    let placed = 0;
    for (const p of pts) {
      const slot = Math.round((p.x - startX) / step);
      if (slot < 0 || slot >= slots) continue;
      // Later samples never overwrite an earlier one: the trace is drawn
      // left-to-right, so the first value at a slot is the one it was drawn at.
      if (uv[slot] != null) continue;
      uv[slot] = Math.round(((p.y - baseline) / unitsPerMv) * 1000);
      placed++;
    }
    // Two ways the grid can be the wrong grid, and both would fabricate a signal:
    // samples that do not land on it, and a grid so fine that the samples are a
    // scattering of dots across a mostly empty row. A printed strip fills its
    // own grid almost completely — the real export is 98 % filled even with its
    // pen-lift gap — so a sparse result means this path is not a strip.
    if (placed < pts.length * 0.95) { dropped++; return; }
    if (placed < slots * 0.5) { dropped++; return; }

    const dtMs = Math.round(((step / unitsPerSecond) * 1000) * 1000) / 1000;
    const t0Ms = Math.round(((startX - x0) / unitsPerSecond) * 1000) + index * stripSpanSec * 1000;
    strips.push({ t0Ms, dtMs, uv });
    points += placed;
    dtMsOfGrid ??= dtMs;
    durationMs = Math.max(durationMs, t0Ms + (slots - 1) * dtMs);
  });

  if (strips.length === 0 || dtMsOfGrid == null) return null;
  return {
    drawnHz: Math.round((1000 / dtMsOfGrid) * 10) / 10,
    durationMs: Math.round(durationMs),
    strips,
    points,
    droppedStrips: dropped,
  };
}

/**
 * Parse an extracted Garmin ECG report.
 *
 * `ok` needs both halves of the recording's identity — the result and the
 * recording time. Everything else is reported as missing and lowers the
 * confidence without failing the import: a report that says what it found and
 * when is worth keeping even if Garmin renames a version line.
 */
export function parseEcgReport(content: EcgPdfContent): EcgParseResult {
  const rows = buildRows(content.items);
  const missing: string[] = [];

  if (rows.length === 0) {
    return { ok: false, report: null, confidence: 0, missing: ["text layer (no text in this PDF — enter it from the Garmin app instead)"] };
  }

  const result = valueUnderLabel(rows, "Result");
  const hrCell = valueUnderLabel(rows, "Average Heart Rate");
  const symptomsCell = valueUnderLabel(rows, "Symptoms Reported");
  const interpretation = valueUnderLabel(rows, "Summary");

  const recordedRaw = allCells(rows).map((c) => c.text).find((t) => parseRecordedAt(t) != null) ?? null;
  const recordedAtLocal = recordedRaw ? parseRecordedAt(recordedRaw) : null;

  const avgHeartRateBpm = num(/(-?\d+(?:\.\d+)?)/.exec(hrCell ?? "")?.[1]);

  const leadLine = findCell(rows, /waveform is similar to/i);
  // Keep only the lead sentence, taken FROM THE MATCH — anchoring at the start
  // of the cell would return whatever sentence happened to be merged in front
  // of it, which is a different statement wearing this field's name.
  const leadNote = leadLine ? (/[^.]*waveform is similar to[^.]*\./i.exec(leadLine)?.[0] ?? leadLine).trim() : null;

  const meta = findCell(rows, /mm\/s\b/) ?? "";
  const paperSpeedMmS = num(/([\d.]+)\s*mm\/s/i.exec(meta)?.[1]);
  const gainMmMv = num(/([\d.]+)\s*mm\/mV/i.exec(meta)?.[1]);
  const sampleRateHz = num(/([\d.]+)\s*Hz/i.exec(meta)?.[1]);
  const ecgAppVersion = /Garmin ECG App:\s*([^\s,]+)/i.exec(meta)?.[1]?.replace(/[.,]$/, "") ?? null;
  const connectWebVersion = /Garmin Connect Web\s+([^\s,]+)/i.exec(meta)?.[1]?.replace(/[.,]$/, "") ?? null;
  const pdfTemplateVersion = /PDF Template\s+([^\s,]+)/i.exec(meta)?.[1]?.replace(/[.,]$/, "") ?? null;
  const backendVersion = /Garmin Connect Backend\s+([^\s,]+)/i.exec(meta)?.[1]?.replace(/[.,]$/, "") ?? null;

  // "Recorded on fenix 9 Pro - inReach, 43 mm 6.38" — the footer line states the
  // device and its software cleanly; the scale line is the fallback.
  const recordedOn = findCell(rows, /^Recorded on\s+/i);
  const fromFooter = recordedOn ? /^Recorded on\s+(.+?)\s+([\d][\d.]*)$/i.exec(recordedOn) : null;
  const fromMeta = /Hz,\s*(.+?)\s+SW\s+([\d][\d.]*)/i.exec(meta);
  const deviceModel = (fromFooter?.[1] ?? fromMeta?.[1] ?? null)?.trim() || null;
  const deviceSoftware = (fromFooter?.[2] ?? fromMeta?.[2] ?? null)?.replace(/[.,]$/, "") || null;

  // Duration comes from the printed second axis ("0s" … "29s"), which is the
  // report's own statement of how long the recording ran.
  const axisSeconds = allCells(rows)
    .map((c) => /^(\d{1,3})s$/.exec(c.text)?.[1])
    .filter((v): v is string => v != null)
    .map(Number);
  const waveform = buildWaveform(content.traces, paperSpeedMmS ?? DEFAULT_MM_PER_SEC, gainMmMv ?? DEFAULT_MM_PER_MV);
  const durationSec = axisSeconds.length > 0
    ? Math.max(...axisSeconds) + 1
    : waveform
      ? Math.round(waveform.durationMs / 1000)
      : null;

  if (!result) missing.push("result");
  if (!recordedAtLocal) missing.push("recording date and time");
  if (avgHeartRateBpm == null) missing.push("average heart rate");
  if (!symptomsCell) missing.push("symptoms reported");
  if (!interpretation) missing.push("summary");
  if (!leadNote) missing.push("lead note");
  if (paperSpeedMmS == null || gainMmMv == null || sampleRateHz == null) missing.push("recording scale");
  if (!deviceModel) missing.push("device");
  if (!pdfTemplateVersion) missing.push("PDF template version");
  if (!waveform) missing.push("waveform trace");
  else if (waveform.droppedStrips > 0) {
    missing.push(`${waveform.droppedStrips} of ${waveform.strips.length + waveform.droppedStrips} strips of the trace`);
  }

  const EXPECTED = 10;
  const confidence = Math.max(0, Math.min(1, (EXPECTED - missing.length) / EXPECTED));

  if (!result || !recordedAtLocal || !recordedRaw) {
    return { ok: false, report: null, missing, confidence };
  }

  return {
    ok: true,
    confidence,
    missing,
    report: {
      result,
      avgHeartRateBpm,
      symptoms: symptomsCell,
      interpretation,
      leadNote,
      recordedAtRaw: recordedRaw,
      recordedAtLocal,
      durationSec,
      paperSpeedMmS,
      gainMmMv,
      sampleRateHz,
      deviceModel,
      deviceSoftware,
      ecgAppVersion,
      connectWebVersion,
      pdfTemplateVersion,
      backendVersion,
      waveform,
    },
  };
}

/**
 * What a surface should print for a stored symptoms cell.
 *
 * Three states, not two: the report said none, the report named something, or
 * the column was never read. Only the first may be shown as "none" — saying it
 * about the third would put words in the report's mouth.
 */
export function symptomsLabel(raw: string | null | undefined): { text: string; reported: boolean } {
  if (raw == null || raw.trim() === "") return { text: "—", reported: false };
  if (/^[-–—]+$/.test(raw.trim())) return { text: "None reported", reported: false };
  return { text: raw.trim(), reported: true };
}
