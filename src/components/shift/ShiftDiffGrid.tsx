import type { DayCounts, ShiftRow } from "@/lib/schedule/shift-suggest";
import { DayCountStrip } from "./DayCountStrip";
import { addDayKey, dayOfMonth, formatDayKey } from "./format";
import { SHIFT_GRID_COLS, WEEKDAY_MONDAY_FIRST } from "./grid";

const GRID = `grid ${SHIFT_GRID_COLS} gap-1 text-center text-xs`;
/** DosesWeek's cell box, minus the fill: each state below picks its own chrome. */
const CELL = "flex h-9 items-center justify-center rounded-control";
/** DosesWeek's glyph span, verbatim — same size, weight and optical centring. */
const GLYPH = "inline-flex items-center justify-center font-bold leading-none text-[13px]";

/**
 * A day cell's mark. Three shapes, never three colours: ○ stays, − moves away,
 * ● moves here (WCAG 1.4.1). `title` duplicates the aria-label rather than
 * replacing it — a hover-only explanation is no explanation on a phone.
 */
function Glyph({ mark, tone, label }: { mark: string; tone: string; label: string }) {
  return (
    <span role="img" aria-label={label} title={label} className={`${GLYPH} ${tone}`}>
      {mark}
    </span>
  );
}

/** One legend entry: the cell's own chrome shrunk to 14px, then the words. */
function LegendItem({ mark, tone, chrome, text }: { mark: string; tone: string; chrome: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] font-bold leading-none text-[12px] ${tone} ${chrome}`}
      >
        {mark}
      </span>
      {text}
    </span>
  );
}

/**
 * A week, drawn the way /doses draws a week: a row per protocol, a cell per
 * day. Every protocol that moves carries its own diff on ONE set of cells (−
 * where it leaves, ○ where it stays, ● where it arrives); every other protocol
 * is identical before and after, so it is drawn once. Under a hairline, the
 * Before and After totals rows repeat the two strips this grid replaced — same
 * component, same data attributes, so the numbers a reader checks and the
 * numbers the tests check are the same element.
 *
 * One mover or many: a standalone rotation has exactly one row with
 * `moved === true`, the combined plan has one per move, and the
 * layout is the same either way — every mover first, in `rows` order, then the
 * protocols that stay put. Each mover row carries `data-shift-row="mover"` AND
 * `data-shift-mover="<protocolId>"`, so a reader of the DOM can tell WHICH
 * protocol a mover row belongs to when there is more than one.
 *
 * Purely presentational: no hooks, no state, no actions — safe as a child of
 * a "use client" card, and it would render unchanged from the server.
 *
 * Today is marked in the HEADER only (weight + aria-current). The bg-accent/10
 * fill DosesWeek uses for today is deliberately not reused on these cells: in
 * this grid a cell's fill already carries "stays" vs "moves away", and a
 * second meaning for the same channel is how a diff becomes unreadable.
 */
export function ShiftDiffGrid({
  rows,
  before,
  after,
  weekStart,
  today,
  captionId,
  caption,
}: {
  rows: ShiftRow[];
  before: DayCounts;
  after: DayCounts;
  /** Monday of the week the rows and totals are measured over ("YYYY-MM-DD"). */
  weekStart: string;
  today: string;
  /** Id of the caption below; it is the grid's accessible name. */
  captionId: string;
  /** Overrides the caption's words; the default names one rotation's week. */
  caption?: string;
}) {
  const week = WEEKDAY_MONDAY_FIRST.map((_, i) => addDayKey(weekStart, i));
  const weekOf = formatDayKey(weekStart);
  // The movers are the rows carrying moved === true (computeShiftPlan pins them
  // first, so these are normally the leading rows — filtered explicitly rather
  // than assumed, so a future reordering could never mislabel a non-mover as
  // one that moves). Empty `rows` (a week every row was filtered out of) leaves
  // the grid with its header and the two totals rows, which still read on their
  // own; `rows` itself is required, not optional — computeShiftPlan always
  // supplies it.
  const movers = rows.filter((r) => r.moved);
  const others = rows.filter((r) => !r.moved);
  // Two protocols of the same peptide (a morning and an evening course, say)
  // would otherwise draw two rows with one name. Only then is the course name
  // worth the width.
  const sharedName = (r: ShiftRow) => rows.filter((x) => x.peptideName === r.peptideName).length > 1;
  /**
   * The name a row is READ by — on the always-visible line and in every one of
   * its cells' aria-labels. A combined plan can move two protocols of the same
   * peptide, and the second line that carries the course name is
   * `sm:block` — hidden at the 375px target width — so peptide-name-only left
   * two mover rows saying the same thing on a phone, and every glyph in both
   * rows announcing the same thing to a screen reader at any width.
   */
  const rowName = (r: ShiftRow) => (sharedName(r) ? `${r.peptideName} · ${r.protocolName}` : r.peptideName);

  /** A non-mover's cells: identical before and after, so ○ or nothing. */
  const plainCells = (r: ShiftRow) =>
    week.map((key, i) => (
      <div key={key} className={`${CELL} bg-line/[0.05]`}>
        {(r.before[i] ?? 0) > 0 && (
          <Glyph mark="○" tone="text-accentStrong" label={`${rowName(r)}: planned dose — ${formatDayKey(key)}`} />
        )}
      </div>
    ));

  /** A mover's cells: the whole of that protocol's move on one row. */
  const moverCells = (r: ShiftRow) =>
    week.map((key, i) => {
      const wasOn = (r.before[i] ?? 0) > 0;
      const isOn = (r.after[i] ?? 0) > 0;
      if (wasOn && isOn)
        return (
          <div key={key} className={`${CELL} bg-line/[0.05]`}>
            <Glyph
              mark="○"
              tone="text-accentStrong"
              label={`${rowName(r)}: planned dose, unchanged — ${formatDayKey(key)}`}
            />
          </div>
        );
      if (wasOn)
        return (
          // Dashed + transparent, so the thin − is never the only cue.
          <div key={key} className={`${CELL} border border-dashed border-line/40 bg-transparent`}>
            <Glyph mark="−" tone="text-muted" label={`${rowName(r)}: moves away — ${formatDayKey(key)}`} />
          </div>
        );
      if (isOn)
        return (
          <div key={key} className={`${CELL} bg-line/[0.05] ring-1 ring-inset ring-accentStrong/50`}>
            <Glyph mark="●" tone="text-accentStrong" label={`${rowName(r)}: moves here — ${formatDayKey(key)}`} />
          </div>
        );
      return <div key={key} className={`${CELL} bg-line/[0.05]`} />;
    });

  return (
    <>
      {/* Says which week without a Now/After label — those read as "the current
          week", which is exactly the confusion here: the engine measures a card
          over the first full week the successor runs, so a card's dates can sit
          later than the panel's strip. */}
      <p id={captionId} className="mb-1 text-xs font-medium text-muted">
        {caption ?? `Week of ${weekOf} — the first full week on the new days`}
      </p>

      {/* At 375 the seven cells are ~32px and fit, so this wrapper does no work
          today. It is inert rather than a guard: SHIFT_GRID_COLS' columns are
          minmax(0,1fr), so the grid's min-content width is the 64px label
          alone and it can always shrink to fit — a future label or font that
          needs more room would have to widen the template's minmax floor
          before this wrapper would ever actually scroll. */}
      <div className="overflow-x-auto">
        <div role="group" aria-labelledby={captionId} className={GRID}>
          <div aria-hidden />
          {week.map((key, i) => (
            <div
              key={key}
              aria-current={key === today ? "date" : undefined}
              className={`pb-1 ${key === today ? "font-semibold text-accentStrong" : "text-muted"}`}
            >
              {WEEKDAY_MONDAY_FIRST[i]}
              <div className="tabular-nums">{dayOfMonth(key)}</div>
            </div>
          ))}

          {movers.map((r) => (
            <div key={r.protocolId} className="contents" data-shift-row="mover" data-shift-mover={r.protocolId}>
              <div
                className="flex flex-col justify-center text-left text-[11px] leading-tight"
                title={`${r.peptideName} · ${r.protocolName}`}
              >
                <span className="truncate font-semibold">
                  {rowName(r)}
                  <span className="ml-1 text-[10px] font-medium uppercase tracking-wide text-accentStrong">moves</span>
                </span>
                {/* The course name has already been pulled up onto the visible
                    line when it is what tells two rows apart, so it is not
                    repeated here. */}
                <span className="hidden truncate text-[10px] text-muted tabular-nums sm:block">
                  {sharedName(r)
                    ? r.times.join(", ")
                    : r.times.length > 0
                      ? `${r.protocolName} · ${r.times.join(", ")}`
                      : r.protocolName}
                </span>
              </div>
              {moverCells(r)}
            </div>
          ))}

          {movers.length > 0 && others.length > 0 && (
            <div aria-hidden className="col-span-full my-0.5 border-t border-line/10" />
          )}

          {others.map((r) => (
            <div key={r.protocolId} className="contents" data-shift-row={r.protocolId}>
              <div
                className="flex flex-col justify-center text-left text-[11px] font-medium leading-tight"
                title={`${r.peptideName} · ${r.protocolName}`}
              >
                <span className="truncate">{rowName(r)}</span>
                {r.times.length > 0 && (
                  <span className="hidden truncate text-[10px] font-normal text-muted tabular-nums sm:block">
                    {r.times.join(", ")}
                  </span>
                )}
              </div>
              {plainCells(r)}
            </div>
          ))}

          {rows.length > 0 && <div aria-hidden className="col-span-full my-0.5 border-t border-line/10" />}
        </div>

        {/* Own elements rather than rows of the grid above: role/aria-label/
            data-shift-strip/data-counts have to sit on a real block, and a
            display:contents wrapper is not one. The shared column template is
            what keeps them aligned with the cells above. */}
        <DayCountStrip variant="row" rowLabel="Before" label="Before" counts={before} caption={`Before · week of ${weekOf}`} />
        <DayCountStrip
          variant="row"
          rowLabel="After"
          label="After"
          counts={after}
          compareTo={before}
          caption={`After · week of ${weekOf}`}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        <LegendItem mark="○" tone="text-accentStrong" chrome="bg-line/[0.05]" text="planned dose" />
        <LegendItem mark="●" tone="text-accentStrong" chrome="bg-line/[0.05] ring-1 ring-inset ring-accentStrong/50" text="moves here" />
        <LegendItem mark="−" tone="text-muted" chrome="border border-dashed border-line/40" text="moves away" />
        {/* One rotation or a whole plan: the ringed cells are whatever this
            grid actually draws a diff for, so the words follow the row count. */}
        <span>outlined count: changes with {movers.length > 1 ? "these moves" : "this move"}</span>
        <span>bold count: highest of the week</span>
      </div>
    </>
  );
}
