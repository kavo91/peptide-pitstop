import "server-only";
/**
 * pdf.js extraction for a Garmin ECG report: the positioned text items AND the
 * vector polyline the waveform is drawn with.
 *
 * This module owns everything that needs pdf.js; `ecg-parse-core.ts` is pure and
 * takes the structures produced here, so the parser is testable from synthetic
 * fixtures with no PDF (and no real health report) in the repo.
 *
 * The same pdf.js constraints the DEXA extractor documents apply here — legacy
 * build, worker handed over on `globalThis`, pinned to the 4.x line. See
 * `pdf-text.ts` for the full reasoning; it is not repeated.
 */
import { getDocument, VerbosityLevel, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import type { TextItem as PdfJsTextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";
import type { PdfPoint, PdfTextItem, EcgPdfContent } from "./ecg-parse-core";

const g = globalThis as { pdfjsWorker?: unknown };
g.pdfjsWorker ??= pdfjsWorker;

/**
 * ONE page. The ECG export is a single landscape page and says so in its own
 * footer ("1 of 1"). Reading further would be worse than useless: pdf.js reports
 * every page in ITS OWN user space, so a second page's items and paths would be
 * merged into the first page's coordinate system and land on top of it.
 */
const MAX_PAGES = 1;
/**
 * A path with at least this many points is a waveform strip, not page furniture.
 * The grid is drawn as thousands of 2-point lines and the logo as ~30-point
 * glyph outlines; a 10-second strip carries ~1200 points.
 */
const MIN_TRACE_POINTS = 200;

type Matrix = [number, number, number, number, number, number];

/** a ∘ b — b applied first, then a (PDF `cm` semantics). */
function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function apply(m: Matrix, x: number, y: number): PdfPoint {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function isTextItem(it: PdfJsTextItem | TextMarkedContent): it is PdfJsTextItem {
  return typeof (it as PdfJsTextItem).str === "string";
}

/**
 * Every point a `constructPath` operator visits, in PAGE space.
 *
 * Curves are reduced to their endpoints: Garmin draws the trace as one cubic
 * segment per sample (the control points are the smoothing, the endpoint is the
 * sample), so the endpoint sequence IS the sampled signal — roughly 128 Hz,
 * decimated by the exporter from the watch's 512 Hz.
 */
function pathPoints(ops: number[], args: number[], ctm: Matrix): PdfPoint[] {
  const pts: PdfPoint[] = [];
  let k = 0;
  for (const op of ops) {
    switch (op) {
      case OPS.moveTo:
      case OPS.lineTo:
        pts.push(apply(ctm, args[k]!, args[k + 1]!));
        k += 2;
        break;
      case OPS.curveTo: // (x1 y1 x2 y2 x3 y3) — x3,y3 is the endpoint
        pts.push(apply(ctm, args[k + 4]!, args[k + 5]!));
        k += 6;
        break;
      case OPS.curveTo2: // (x2 y2 x3 y3) — current point doubles as the first control point
      case OPS.curveTo3: // (x1 y1 x3 y3)
        pts.push(apply(ctm, args[k + 2]!, args[k + 3]!));
        k += 4;
        break;
      case OPS.rectangle:
        k += 4;
        break;
      case OPS.closePath:
        break;
      default:
        // An operator this reader does not model would desynchronise `k` and
        // silently mangle every later point, so the path is abandoned instead.
        return [];
    }
  }
  return pts;
}

/**
 * Text items and waveform polylines from an ECG PDF, in page coordinates
 * (origin bottom-left, y increasing UP — so a positive ECG deflection has the
 * larger y, exactly as it looks on the printed page).
 *
 * A PDF with no text layer yields no items; the parser reports that as an
 * unreadable report rather than as 20 missing fields.
 */
export async function extractEcgPdf(buffer: Buffer): Promise<EcgPdfContent> {
  const task = getDocument({
    data: new Uint8Array(buffer),
    verbosity: VerbosityLevel.ERRORS,
    useSystemFonts: false,
    disableFontFace: true,
  });
  const doc = await task.promise;
  try {
    const items: PdfTextItem[] = [];
    const traces: PdfPoint[][] = [];
    const n = Math.min(doc.numPages, MAX_PAGES);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      try {
        const tc = await page.getTextContent({ disableNormalization: true });
        for (const it of tc.items) {
          if (!isTextItem(it) || !it.str) continue;
          items.push({
            str: it.str,
            x: it.transform[4] ?? 0,
            y: it.transform[5] ?? 0,
            width: it.width ?? 0,
            height: it.height ?? 0,
          });
        }

        // The CTM has to be tracked by hand: pdf.js hands `constructPath` its
        // coordinates in the space current at the time it was issued, and every
        // strip sits under its own `cm` inside a soft-masked group.
        //
        // `save`/`restore`/`transform` are NOT the only operators that move it.
        // pdf.js emits no explicit save/restore around a form XObject — the
        // push, the form's own /Matrix and the pop all live inside
        // paintFormXObjectBegin/End, and beginGroup/endGroup are another
        // implicit pair. Skipping them drops a form's matrix and lets an
        // unbalanced `cm` inside one leak out into everything drawn after it,
        // which would scale a whole strip with nothing reporting a problem.
        const ol = await page.getOperatorList();
        let ctm: Matrix = [1, 0, 0, 1, 0, 0];
        const stack: Matrix[] = [];
        for (let j = 0; j < ol.fnArray.length; j++) {
          const fn = ol.fnArray[j];
          if (fn === OPS.save || fn === OPS.beginGroup) stack.push(ctm);
          else if (fn === OPS.restore || fn === OPS.endGroup || fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
          else if (fn === OPS.transform) ctm = mul(ctm, ol.argsArray[j] as Matrix);
          else if (fn === OPS.paintFormXObjectBegin) {
            stack.push(ctm);
            const matrix = (ol.argsArray[j] as unknown[])[0];
            if (Array.isArray(matrix) && matrix.length === 6 && matrix.every((v) => typeof v === "number")) {
              ctm = mul(ctm, matrix as Matrix);
            }
          } else if (fn === OPS.constructPath) {
            const [ops, args] = ol.argsArray[j] as [number[], number[]];
            if (ops.length < MIN_TRACE_POINTS) continue;
            const pts = pathPoints(ops, args, ctm);
            if (pts.length >= MIN_TRACE_POINTS) traces.push(pts);
          }
        }
      } finally {
        page.cleanup();
      }
    }
    return { items, traces };
  } finally {
    await doc.destroy();
  }
}
