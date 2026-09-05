import { CalendarRange } from "lucide-react";
import type { ShiftPanelData } from "@/lib/shift/server";
import { DayCountStrip } from "./DayCountStrip";
import { ShiftPlanCard } from "./ShiftPlanCard";
import { ShiftPinToggle } from "./ShiftPinToggle";
import { formatDayKey } from "./format";

/** Copy for each reason the engine will not move a protocol — one per
 * SkipReason from eligibility() in shift-suggest.ts. `no_rule` (no schedule at
 * all) reads the same as `not_weekly`: neither is a weekly-by-day pattern
 * rotation can touch. */
const INELIGIBLE_TEXT: Record<ShiftPanelData["ineligible"][number]["reason"], string> = {
  stack: "in a stack, not eligible",
  ends_soon: "course ends within a week",
  not_weekly: "not a weekly pattern",
  no_rule: "not a weekly pattern",
};

/**
 * "Smooth your week" — server component, no client behaviour of its own. Logic
 * lives in getShiftPanelData (engine + eligibility) and the child client
 * islands (Apply sheet, pin toggle); this just lays the facts out.
 */
export function ShiftPanel({ data }: { data: ShiftPanelData }) {
  // ONE combined card, never a list of separate ones. `combined` is the
  // whole-plan answer; `suggestions` stays in the data because each move's
  // "Apply just this" sheet is still a single-move apply.
  const combined = data.plan.combined;
  return (
    <section id="smooth-your-week" data-shift-panel className="mb-8">
      <div className="mb-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
          <CalendarRange className="h-4 w-4 text-muted" aria-hidden />
          Smooth your week
        </h2>
        <p className="mt-1 text-xs text-muted">
          Doses per day in the coming week, and how a day rotation would spread them. Amounts, times and doses per
          week do not change.
        </p>
        {combined && (
          <p className="mt-1 text-xs text-muted">
            One plan for the week, applied as a set. The grid shows the week as on Doses: one row per protocol, one
            cell per day, with a row for each protocol that moves. Each change below also shows the week it would give
            on its own.
          </p>
        )}
      </div>

      {data.unavailable ? (
        <p data-shift-state="unavailable" className="rounded-control bg-bg px-3 py-2 text-sm text-muted ring-1 ring-line/15">
          Suggestions are unavailable right now.
        </p>
      ) : (
        <>
          <div>
            {/* The visible caption names the strip's Monday — on a Tue–Sun
                "This week" was next week. The DayCountStrip `label` (and so
                data-shift-strip / aria-label) stays "This week": tests
                key on it. */}
            <p className="mb-1 text-xs font-medium text-muted">Week of {formatDayKey(data.plan.weekStart)}</p>
            <DayCountStrip counts={data.plan.current} label="This week" caption={`Week of ${formatDayKey(data.plan.weekStart)}`} />
          </div>

          {/* No combined plan AND no single rotation means no combination came
              out flatter than standing still — a single rotation IS one such
              combination, so today the two conditions coincide and the second
              is a guard, not a live branch. It is the same guard ShiftNudge
              applies: without it, a plan the panel could not draw would leave
              the nudge counting suggestions the panel then called a flat week.
              There is no standalone card list, so that case has nothing to
              draw — it says so rather than contradicting the nudge. */}
          {combined === null ? (
            data.plan.suggestions.length === 0 ? (
              <p data-shift-state="flat" className="mt-4 text-sm text-muted">
                Your week is already as flat as a rotation can make it.
              </p>
            ) : (
              <p data-shift-state="no-plan" className="mt-4 text-sm text-muted">
                No plan for the week to show right now. Refresh to see the current suggestions.
              </p>
            )
          ) : (
            <div data-shift-state="suggestions" className="mt-4">
              {/* Whitelisted at the server/client boundary: the sheet reads
                  twelve fields, while a whole ShiftSuggestion also carries
                  rows[] (one entry per active protocol, each with two 7-element
                  vectors), perTime and before/after — an RSC payload growing
                  with the square of the protocol count for data nothing here
                  renders. */}
              <ShiftPlanCard
                plan={combined}
                suggestions={data.plan.suggestions.map((sg) => ({
                  protocolId: sg.protocolId,
                  peptideName: sg.peptideName,
                  k: sg.k,
                  fromDays: sg.fromDays,
                  toDays: sg.toDays,
                  times: sg.times,
                  startDate: sg.startDate,
                  lastDoseDate: sg.lastDoseDate,
                  usualGapDays: sg.usualGapDays,
                  protocolStartDate: sg.protocolStartDate,
                  courseEndDate: sg.courseEndDate,
                  fingerprint: sg.fingerprint,
                }))}
                today={data.today}
              />
            </div>
          )}

          {data.pinned.length > 0 && (
            <details data-shift-pinned className="mt-4 text-sm">
              <summary className="cursor-pointer text-muted">Kept as is ({data.pinned.length})</summary>
              <ul className="mt-2 space-y-2">
                {data.pinned.map((p) => (
                  <li key={p.protocolId} className="flex items-center justify-between gap-2">
                    <span>
                      {p.peptideName} · {p.name}
                    </span>
                    <ShiftPinToggle protocolId={p.protocolId} pinned={true} mode="button" />
                  </li>
                ))}
              </ul>
            </details>
          )}

          {data.ineligible.length > 0 && (
            <div className="mt-4 space-y-1">
              {data.ineligible.map((row) => (
                <p key={row.protocolId} data-shift-ineligible className="text-xs text-muted">
                  {row.peptideName} · {row.name} — {INELIGIBLE_TEXT[row.reason]}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
