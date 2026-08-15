# Reorder forecast — design rulings

Why `lib/reorder-forecast.ts` looks the way it does. The `R…` ids are cited from
the code; this file is the reason a future reader is looking for.

## The defect this replaced

Coverage used to be a flat forever rate:

```
coverageDays = round(totalDoses / dosesPerWeek × 7)
```

`dosesPerWeek` came from `schedule/frequency.ts`, which expands the schedule over
a fixed synthetic 4-week window — so the protocol's own `startDate`/`endDate`
never entered the maths, nothing read the cycle plan, and the per-injection dose
was sampled once at `now`, making a later titration step invisible.

Four false positives followed: a course that ends before the stock does still
demanded a reorder; cycling protocols were costed through their off-weeks; a
protocol starting weeks from now burned stock today; and a ramping course was
priced entirely at its opening step.

The fix walks the protocol's real future slots and draws each one from inventory
until the stock cannot serve a slot.

## Rulings

**R1 — the status set stays small; the reason rides as data.**
`ok | reorder_now | covered | unknown`, plus `coverageBasis`
(`depletion | cycle_end | course_end | horizon`), `courseEndDate` and
`phaseToday`. A repeating on/off course never "ends", so a status named for a
course ending could not bind a date for exactly the protocols that need one.

**R2 — never depleted ⇒ `covered`.** `ok` keeps its old invariant (every date
field populated), so no consumer meets a new shape for a status it already
handles.

**R3 / R26 — a data gap is `unknown`, never `covered`.** Zero slots, or a
schedule that cannot be parsed, must not render as reassurance. Reassurance
manufactured from missing information is the worst available direction to fail.

**R11 — reconstituted stock dies at its beyond-use date.** Without this gate a
365-day walk drains one prep across a year. A 10 mg vial at 250 mcg twice weekly
is 40 doses by mass but only ~8 within a 28-day BUD. A null `beyondUseDate`
(written whenever the user leaves the field blank) falls back to the resolved BUD
window rather than meaning "no limit". A sealed vial opened mid-walk starts its
own clock at the simulated open date.

**R12 — the resolver's `""` dose is a sentinel, not a value.** `resolve.ts`
yields the empty string rather than guess, so callers "fail safe rather than
overdose". `new Decimal("")` throws; check before constructing.

**R13 — resolve the dose inside the container loop.** For an `ml`/`units` dose
the mass is a function of *which* container it comes from.

**R14 — a dose costs what the logger charges.** `computeDraw().deliveredVolumeMl`
— the syringe-rounded volume the write path actually decrements — not the nominal
volume. 2 mL @ 7500 mcg/mL at 500 mcg is 28 doses, not 30. The forecast and the
logger must not disagree about what a dose costs. Sealed vials are the documented
exception: rounding needs a concentration they do not have until reconstitution.

**R15 — model the draw order the app performs.** Open preps first, newest
reconstitution first, then sealed. Drawing the sooner-expiring prep first
harvests doses that would really be stranded past its BUD.

**R16 — Decimal throughout.** `pool = 0.3, need = 0.1` in floats yields 2 doses,
not 3. Guard with `.gte()`, convert to `number` once at the day-count boundary.
Note the `engine` import sets `Decimal` precision as a module side effect.

**R17 — refuse what cannot be converted.** `substanceClass === "IU"` is never
mass-converted. Syringe `unitsPerMl` comes from the protocol's syringe, so U-40
and U-50 are not silently mis-scaled. The horizon is bounded by slot count, since
a twice-daily schedule emits ~730 slots a year.

**R23 — planned off-weeks are NOT skipped.** The cycle plan is read only by the
cycle module and its display consumers; it never reaches `today.ts` or the
resolver. So during a planned off-week the app still shows the dose as due and
the user takes it. Discounting those slots would overstate coverage by 25–33% on
exactly the protocols this fix targets. Conservative is correct when the app and
the plan disagree. The gate stops the walk only for a terminal course — one with
on-weeks but no off-weeks — and keys on that rather than on the "ended" phase,
which only becomes true after the stop has already passed.

**R24 — walk by slot status, not by date.** Consume `projected` and `pending`;
never `taken`, `missed` or `skipped`. A `date > today` test drops today's own
unlogged slot and understates every daily protocol by a dose, every day.

**R25 — rebase whole weeks.** Starting the range mid-week hands the rebaser a
complete grid against a truncated slot list, and it re-anchors already-past grid
days forward — producing two draws in a week that should have one.

**R6 — keep the sort rank exhaustive.** `Record<ReorderStatus, number>` under
`strict` makes a new status a compile error. Softening it to `Partial` makes the
subtraction `NaN`, which is falsy, so `||` falls through to the date comparator:
the order stays deterministic but `reorder_now` quietly loses priority — silent,
and far harder to notice than a crash.

**R8 — per-vial figures are labelled "at current rate".** `inventory.ts` keeps a
flat per-vial number answering "how long does THIS vial last at today's cadence".
It is deliberately not the protocol-aware forecast, and the label says so, so the
two numbers on the same page cannot be read as the same claim.

## Claims the forecast must not make

- Coverage to a date the walk never simulated. The end is clamped to the last
  slot actually walked; a course ending years out is not evidence of anything
  beyond the horizon.
- "Beyond 12 months" for a walk truncated by the slot cap.
- A negative or past-dated coverage figure. A protocol whose end fell earlier in
  the current week still contributes a past `pending` slot.
