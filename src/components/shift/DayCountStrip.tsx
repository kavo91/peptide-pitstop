import { DAY_LABELS, type WeekdayCode } from "@/lib/schedule/schedule";
import type { DayCounts } from "@/lib/schedule/shift-suggest";
import { SHIFT_GRID_COLS } from "./grid";

/** DayCounts is Monday-first (index 0 = Mon); this is the display order. */
const MONDAY_FIRST: WeekdayCode[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** "+1" / "−1" — U+2212 MINUS SIGN, not a hyphen: it lines up with tabular digits. */
function signedDelta(d: number): string {
  return d > 0 ? `+${d}` : `−${Math.abs(d)}`;
}

/**
 * Seven-cell Mon…Sun dose count strip. Presentational only — no client
 * behaviour — so it renders equally well from a server component (the panel's
 * "This week" strip) or inside a "use client" card (Before/After).
 *
 * When `compareTo` is given, a cell whose count differs gets a ring so a
 * change reads without relying on colour alone (WCAG non-colour cue).
 *
 * Two layouts, one component. `variant="strip"` (the default) is the panel's
 * standalone strip and is unchanged. `variant="row"` draws the same counts as
 * a labelled row of the card's week grid, on the shared SHIFT_GRID_COLS
 * template so its cells sit under the protocol cells above them. The variant
 * only swaps the className and the children: role, aria-label,
 * data-shift-strip and data-counts stay on the SAME single wrapper element in
 * both, because tests read data-counts out of the one tag enclosing
 * data-shift-strip.
 */
export function DayCountStrip({
  counts,
  compareTo,
  label,
  caption,
  variant = "strip",
  rowLabel,
}: {
  counts: DayCounts;
  compareTo?: DayCounts;
  /** Stable machine key — `data-shift-strip` (tests assert on it). */
  label: string;
  /** The visible caption above the strip; it is also the accessible name, so a
   *  screen reader hears the same week the sighted reader sees. */
  caption?: string;
  /** "strip" = the panel's own seven cells; "row" = a row of a card's grid. */
  variant?: "strip" | "row";
  /** Row variant only: the text in the grid's label column. Defaults to `label`. */
  rowLabel?: string;
}) {
  const peak = Math.max(...counts);
  const isRow = variant === "row";
  const name = rowLabel ?? label;
  return (
    <div
      role="group"
      aria-label={caption ?? label}
      data-shift-strip={label}
      data-counts={counts.join(",")}
      className={
        isRow
          ? // mt-1 belongs on this element, not a wrapper: the totals rows are
            // siblings of the protocol grid rather than children of it, so the
            // gap above them has to come from the row itself.
            `grid ${SHIFT_GRID_COLS} mt-1 gap-1 text-center text-xs`
          : "flex gap-1"
      }
    >
      {isRow && (
        <div
          className={`flex items-center text-left text-[11px] font-medium ${name === "Before" ? "text-muted" : ""}`}
        >
          {/* truncate on the text node, not this flex container — text-overflow
              has no effect on the anonymous flex item a bare string becomes. */}
          <span className="truncate">{name}</span>
        </div>
      )}
      {MONDAY_FIRST.map((code, i) => {
        const n = counts[i] ?? 0;
        const isPeak = peak > 0 && n === peak;
        const was = compareTo?.[i];
        const changed = was !== undefined && was !== n;
        if (!isRow) {
          return (
            <div
              key={code}
              aria-label={`${DAY_LABELS[code]}: ${n} doses`}
              className={`flex flex-1 flex-col items-center gap-0.5 rounded-control px-1 py-1.5 ${
                changed ? "ring-1 ring-line/30" : ""
              }`}
            >
              <span className="text-xs text-muted">{DAY_LABELS[code]}</span>
              <span className={`text-xs tabular-nums ${isPeak ? "font-semibold" : ""}`}>{n}</span>
            </div>
          );
        }
        return (
          <div
            key={code}
            // The weekday is already in the header column above, but a cell read
            // on its own has to name its own day — and say what it changed from.
            aria-label={changed ? `${DAY_LABELS[code]}: ${n} doses after, was ${was}` : `${DAY_LABELS[code]}: ${n} doses`}
            className={`flex h-9 flex-col items-center justify-center rounded-control bg-line/[0.05] leading-none tabular-nums ${
              changed ? "ring-1 ring-inset ring-line/30" : ""
            }`}
          >
            <span className={`text-xs ${isPeak ? "font-semibold" : ""}`}>{n}</span>
            {changed && <span aria-hidden className="text-[10px] text-muted">{signedDelta(n - (was as number))}</span>}
          </div>
        );
      })}
    </div>
  );
}
