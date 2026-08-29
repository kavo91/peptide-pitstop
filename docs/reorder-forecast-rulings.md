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

**R8 — SUPERSEDED.** Originally: keep `inventory.ts`'s flat per-vial number and
label it "at current rate" so it could not be confused with the forecast. That
was a holding position taken to avoid widening the change while the forecast was
still unproven. The forecast is now proven, so the per-vial figure walks the same
slots through `forecastCoverage` with a single container — answering "when does
THIS vial run out" while honouring course end, cycling, titration and the BUD.
Both surfaces derive their schedule from `forecast-slots.ts`, which is what stops
them drifting apart. Labels reverted to "Runs out in" / "Coverage", which are now
accurate. A vial whose course ends before it does shows "—", not a run-out day it
will never reach.

**R29 — IU substances get no special case.** `substanceClass` drives no
arithmetic anywhere in this app: the strength field is labelled "Strength mg" for
every peptide, and dose logging, reconstitution and inventory all read
"mcg per mL" as strength-units-per-mL. An IU peptide's numbers are therefore
self-consistent on their own scale. An earlier blanket refusal made the forecast
the ONLY surface that could not answer for HCG or Somatropin, while the inventory
page beside it counted their doses happily. Silence that contradicts the
neighbouring surface is not caution, it is a second defect.

**R30 — a repeating course's next on-cycles are projected as provisional
demand.** A repeating course whose `endDate` is the cycle plan's own stop
(`endsOnPlan`) used to end the walk there. The forecast then went blind at the
break: covered-to-cycle-end all through the off-weeks, and the flip to
`reorder_now` came only when the user clicked "start next cycle" — after the
shipping window had closed. Now the walk resolves with the end lifted, drops
every slot inside an off-window, and continues into the projected next
on-cycles. Three consequences, each deliberate:

- **The reorder date keys to the restart, not the last served slot.** When the
  first UNSERVED slot sits past `projectionStartsOn`, `reorderByDate` is
  `restart − leadTime` and the status compares the restart's distance against
  `leadTime + buffer`. `depletion − leadTime` across a four-week break would
  demand the order six weeks early; false urgency is its own failure in a tile
  whose credibility is the product. Depletion inside the committed cycle keeps
  the old arithmetic untouched. The basis is carried as `projected_restart` so
  the copy can say WHY the date is early ("for next cycle").
- **The projection assumes the restart happens on plan.** Restarts are manual
  (`startNextCycle` moves the anchor); a user who restarts late simply sees the
  projection — and the reorder date — slide with reality on the next render.
- **A mid-ladder titration can sit up to a step ahead in projected cycles.** The
  resolver's phase cursor walks the (later discarded) break days too, so a
  dose-count ladder advances through the break in the projection while the real
  course resumes where it stopped. Conservative direction: orders earlier,
  never later. Revisit only if a real course is mid-ladder across a break.
- `cycle_end` is no longer emitted as a stop reason (the walk no longer stops
  there); the type member and its copy remain for older readers of the field.
- An `endDate` that is NOT the plan's stop means the user chose to finish
  early: that stays a plain `course_end` with no projection. Likewise an
  endDate-less repeating course keeps R23 — its break days still cost stock,
  because `today.ts` still shows them as due.

## Claims the forecast must not make

- Coverage to a date the walk never simulated. The end is clamped to the last
  slot actually walked; a course ending years out is not evidence of anything
  beyond the horizon.
- "Beyond 12 months" for a walk truncated by the slot cap.
- A negative or past-dated coverage figure. A protocol whose end fell earlier in
  the current week still contributes a past `pending` slot.
