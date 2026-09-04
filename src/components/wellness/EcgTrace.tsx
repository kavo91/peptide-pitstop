/**
 * The ECG trace, re-drawn from the imported report in the app's own palette.
 *
 * The geometry is the report's: one row per printed strip, at the paper speed
 * and gain the report states (25 mm/s, 10 mm/mV), so a big square is 0.2 s wide
 * and 0.5 mV tall exactly as it is on the page. The SVG viewBox is in
 * MILLIMETRES for that reason — the drawing is scaled to whatever width it is
 * given, but the ratio between time and voltage is never distorted.
 *
 * Nothing here reads the trace. It is a faithful redraw; the words next to it
 * are Garmin's.
 *
 * Pure presentational server component.
 */
import type { EcgWaveform } from "@/lib/ecg-parse-core";

/** Blank space at the left of the row for the 1 mV calibration bar. */
const PAD_LEFT_MM = 7;
/** Amplitude window, in millimetres either side of the baseline. */
const MIN_HALF_MM = 10;
const MAX_HALF_MM = 40;

function secondsLabel(ms: number): string {
  const s = Math.round(ms / 100) / 10;
  return `${Number.isInteger(s) ? s : s.toFixed(1)}s`;
}

/**
 * `M x y L x y …`, restarted at every hole so a stretch the report did not draw
 * is a break in the line rather than a straight segment that was never recorded.
 */
function stripPath(uv: (number | null)[], dtMs: number, mmPerSec: number, mmPerMv: number, leadMm: number): string {
  const xStep = (dtMs / 1000) * mmPerSec;
  let d = "";
  let pen = false;
  for (let i = 0; i < uv.length; i++) {
    const v = uv[i];
    if (v == null) { pen = false; continue; }
    const x = (leadMm + i * xStep).toFixed(2);
    const y = (-(v / 1000) * mmPerMv).toFixed(2);
    d += `${pen ? "L" : "M"}${x} ${y}`;
    pen = true;
  }
  return d;
}

/**
 * Every strip drawn to ONE time scale, so a big square means the same thing in
 * all three and a strip that starts late starts late on the page too.
 *
 * The row length is the longest strip rounded to a whole second — that is the
 * span the export lays each row out at — and a strip's lead-in is how far into
 * its own row it began.
 */
function rowGeometry(strips: { t0Ms: number; dtMs: number; uv: unknown[] }[], mmPerSec: number) {
  const spans = strips.map((s) => (s.uv.length - 1) * s.dtMs);
  const rowMs = Math.max(1000, Math.round(Math.max(...spans) / 1000) * 1000);
  const leads = strips.map((s) => ((s.t0Ms % rowMs) + rowMs) % rowMs);
  const widthMm = (Math.max(...leads.map((lead, i) => lead + spans[i]!)) / 1000) * mmPerSec;
  return { leads, spans, widthMm: Math.max(1, widthMm) };
}

export interface EcgTraceProps {
  waveform: EcgWaveform;
  /** Millimetres per second, as printed on the report. */
  mmPerSec?: number | null;
  /** Millimetres per millivolt, as printed on the report. */
  mmPerMv?: number | null;
  /** Unique within the page — the grid patterns are referenced by id. */
  id: string;
  /** Accessible description of what the trace shows. */
  label: string;
}

export function EcgTrace({ waveform, mmPerSec, mmPerMv, id, label }: EcgTraceProps) {
  const speed = mmPerSec && mmPerSec > 0 ? mmPerSec : 25;
  const gain = mmPerMv && mmPerMv > 0 ? mmPerMv : 10;

  const samples = waveform.strips.flatMap((s) => s.uv).filter((v): v is number => v != null);
  if (samples.length === 0) return null;
  const peakMv = Math.max(...samples.map((v) => Math.abs(v))) / 1000;

  // Round the window out to a whole big square so the grid always ends on a line.
  const halfMm = Math.min(
    MAX_HALF_MM,
    Math.max(MIN_HALF_MM, Math.ceil((peakMv * gain + 2) / 5) * 5),
  );
  const heightMm = halfMm * 2;
  const row = rowGeometry(waveform.strips, speed);
  // Said as the row actually is, not as ten seconds: a future export could lay
  // the recording out in a different number of strips.
  const rowSeconds = Math.round(row.widthMm / speed);
  const rowSecondsLabel = `${rowSeconds} second${rowSeconds === 1 ? "" : "s"}`;

  return (
    <div className="space-y-2">
      {/* At true scale a ten-second strip is 250 mm wide, so on a phone it would
          be about 1.3 px per millimetre — the rhythm is visible but the shape of
          a beat is not. The row is given a floor width instead and the whole
          stack scrolls sideways together, which keeps every strip on the same
          scale AND vertically aligned with the others while you read across.
          Above ~560 px of card the floor is inert and nothing scrolls. */}
      {/* Focusable so the arrow keys can pan it. Some browsers make a scrollable
          box keyboard-reachable on their own and some still do not, and a region
          that only a pointer can reach is content a keyboard user cannot get to. */}
      <div
        className="-mx-1 overflow-x-auto overscroll-x-contain px-1"
        tabIndex={0}
        role="group"
        aria-label={`${label} — scrollable`}
      >
        <div className="min-w-[40rem] space-y-3">
          {waveform.strips.map((strip, index) => {
            const leadMm = (row.leads[index]! / 1000) * speed;
            const widthMm = row.widthMm;
            const endMs = strip.t0Ms + row.spans[index]!;
            const gridId = `${id}-grid-${index}`;
            return (
              <figure key={strip.t0Ms} className="m-0">
                <svg
                  viewBox={`${-PAD_LEFT_MM} ${-halfMm} ${widthMm + PAD_LEFT_MM} ${heightMm}`}
                  className="block w-full"
                  style={{ height: "auto" }}
                  role="img"
                  aria-label={`${label} — ${secondsLabel(strip.t0Ms)} to ${secondsLabel(endMs)}`}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <defs>
                    {/* ECG paper: 1 mm squares inside 5 mm squares. Red is the paper
                        convention for this grid, not a warning colour — it is drawn
                        at low alpha so the trace, not the grid, carries the contrast. */}
                    <pattern id={`${gridId}-sm`} width="1" height="1" patternUnits="userSpaceOnUse">
                      <path d="M1 0V1M0 1H1" fill="none" stroke="rgb(var(--danger))" strokeOpacity="0.16" strokeWidth="0.1" />
                    </pattern>
                    <pattern id={`${gridId}-lg`} width="5" height="5" patternUnits="userSpaceOnUse">
                      <rect width="5" height="5" fill={`url(#${gridId}-sm)`} />
                      <path d="M5 0V5M0 5H5" fill="none" stroke="rgb(var(--danger))" strokeOpacity="0.34" strokeWidth="0.22" />
                    </pattern>
                  </defs>

                  <rect x="0" y={-halfMm} width={widthMm} height={heightMm} fill={`url(#${gridId}-lg)`} />

                  {/* 1 mV calibration bar — the reader's scale, drawn the way a
                      printed ECG prints it. */}
                  <path
                    d={`M${-PAD_LEFT_MM + 1} ${gain / 2} H${-PAD_LEFT_MM + 3} V${-gain / 2} H${-PAD_LEFT_MM + 5}`}
                    fill="none"
                    stroke="rgb(var(--muted))"
                    strokeWidth="1"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />

                  {/* The stroke is held at a constant screen width. A millimetre-wide
                      line would be under half a pixel on a phone and invisible; the
                      SHAPE is what carries the meaning here, not the ink's thickness. */}
                  <path
                    d={stripPath(strip.uv, strip.dtMs, speed, gain, leadMm)}
                    fill="none"
                    stroke="rgb(var(--ink))"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <figcaption className="mt-1 flex justify-between text-[11px] tabular-nums text-muted">
                  <span>{secondsLabel(strip.t0Ms)}</span>
                  <span>{secondsLabel(endMs)}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </div>
      {/* Shown only where the floor width can actually exceed the card. The page
          container stays a 448 px column until `lg` (see PAGE_MAIN), so `md` is
          the wrong breakpoint here — at 768 px this row still scrolls. */}
      <p className="text-[10px] text-muted lg:hidden">
        Swipe a strip sideways for the rest of its {rowSecondsLabel}.
      </p>
      <p className="text-[10px] text-muted">
        {speed} mm/s, {gain} mm/mV — one big square is {(5 / speed).toFixed(2)} s wide and{" "}
        {(5 / gain).toFixed(1)} mV tall, and the bracket at the left of each row is 1 mV. Drawn from
        the report; the shape is the report&apos;s, the size follows the screen.
      </p>
    </div>
  );
}
