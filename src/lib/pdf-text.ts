import "server-only";
// pdf.js (pdfjs-dist) legacy build, run in-process: no worker thread. This
// replaced pdf-parse's bundled pdf.js v1.10, whose module-global parser state
// produced intermittent `FormatError: bad XRef entry` on valid, byte-identical
// PDFs when two server-action invocations parsed at once (reproduced 2026-09-02
// with the 25-upload harness at concurrency 3; 0/50 failures with this module).
//
// The worker bundle is imported statically and handed to pdf.js through
// `globalThis.pdfjsWorker` (its documented main-thread hook) rather than left to
// the library's own `import("./pdf.worker.mjs")`: that runtime-relative import is
// invisible to Next's output file tracing, so the standalone image would ship
// pdf.mjs without its worker. The package stays in `experimental.serverComponentsExternalPackages` (`serverExternalPackages` on Next 15)
// (next.config.mjs) so Node loads both files natively.
//
// Pinned to the 4.x line on purpose: 5.x evaluates `new DOMMatrix()` at module
// load and so cannot even be imported without the optional native
// `@napi-rs/canvas` package, which file tracing does not carry into the
// standalone image. 4.x only warns when canvas is absent (four one-time
// "Cannot polyfill …" lines at first use) and text extraction is unaffected —
// verified against the traced standalone tree with no canvas on the path.
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import type { TextItem as PdfJsTextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";

const g = globalThis as { pdfjsWorker?: unknown };
g.pdfjsWorker ??= pdfjsWorker;

/** The subset of a pdf.js text item the row layout needs. */
export interface TextItem { str: string; transform: number[]; width: number; height: number }

/** Vertical distance (PDF units) within which two items count as the same row. */
const ROW_TOLERANCE = 2;
/** Reports are 2–4 pages; cap the work an oversized upload can cause. */
const MAX_PAGES = 8;

/**
 * Lay a page's text items out as rows. pdf.js's own text joiner glues same-row
 * items together with no separator ("L Arm200.001000.0"), which breaks every
 * table anchor the Hologic parser relies on. Here items are grouped into rows
 * by baseline y, ordered left→right, and separated by a space whenever the
 * horizontal gap between two items is wider than a fraction of the text height
 * (adjacent glyph runs of one word stay joined; table cells get a space).
 */
export function renderPageText(items: TextItem[]): string {
  const rows: { y: number; items: TextItem[] }[] = [];
  for (const it of items) {
    if (!it.str) continue;
    const y = it.transform[5] ?? 0;
    const row = rows.find((r) => Math.abs(r.y - y) <= ROW_TOLERANCE);
    if (row) row.items.push(it); else rows.push({ y, items: [it] });
  }
  rows.sort((a, b) => b.y - a.y); // PDF user space: larger y is higher on the page
  return rows
    .map((row) => {
      const sorted = [...row.items].sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0));
      let text = ""; let prevEnd: number | null = null;
      for (const it of sorted) {
        const x = it.transform[4] ?? 0;
        const gapThreshold = Math.max(0.15 * (it.height || 10), 0.5);
        if (prevEnd != null && x - prevEnd > gapThreshold && !text.endsWith(" ") && !it.str.startsWith(" ")) text += " ";
        text += it.str;
        prevEnd = x + (it.width || 0);
      }
      return text;
    })
    .join("\n");
}

/** pdf.js interleaves marked-content markers with text items; keep the text. */
function isTextItem(it: PdfJsTextItem | TextMarkedContent): it is PdfJsTextItem {
  return typeof (it as PdfJsTextItem).str === "string";
}

/**
 * Text layer of a PDF (first 8 pages), one line per printed row, pages separated
 * by a blank line. A PDF with no text layer yields "" (the parser then reports
 * the report as unreadable); a malformed file rejects. Pure JS — no poppler or
 * other system package.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  return (await extractPdfTextPages(buffer)).text;
}

export const MAX_PDF_PAGES = MAX_PAGES;
export interface PdfTextResult { text: string; numPages: number; pagesRead: number }

/** `extractPdfText` plus the page count, so a caller can say when pages beyond the cap were not read. */
export async function extractPdfTextPages(buffer: Buffer): Promise<PdfTextResult> {
  // pdf.js takes ownership of the bytes it is handed; give it a private copy.
  const task = getDocument({
    data: new Uint8Array(buffer),
    verbosity: VerbosityLevel.ERRORS,
    useSystemFonts: false,
    disableFontFace: true,
  });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    const n = Math.min(doc.numPages, MAX_PAGES);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      try {
        // No Unicode normalisation: the Hologic parser folds ²/³ and NBSP itself.
        const tc = await page.getTextContent({ disableNormalization: true });
        pages.push(renderPageText(tc.items.filter(isTextItem)));
      } finally {
        page.cleanup();
      }
    }
    const text = pages.join("\n\n");
    return { text: /\S/.test(text) ? text : "", numPages: doc.numPages, pagesRead: n }; // no text layer at all → "" (not blank page separators)
  } finally {
    await doc.destroy();
  }
}
