/**
 * Dashboard — command-center home screen.
 *
 * Layout (top to bottom):
 *   1. Page header: "Dashboard", date, cycle-day badge
 *   2. Cheap summary tiles (Supply, CycleDay/ProtocolDay) — render immediately
 *   3. Analytics tiles (Adherence, Plasma) — Suspense-wrapped with skeleton
 *   4. TodaysDosesCard — actionable dose section (day-nav inside the card)
 *   5. WellnessTile — 7-day wellness trend (weight/mood/energy sparkline)
 *
 * Heavy data: getAnalyticsData is called inside AnalyticsTiles (a nested async
 * RSC) so it never blocks the dose section or cheap tiles.
 */
import { Suspense } from "react";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/owner";
import { prisma } from "@/lib/db";
import { getTodayDoses, getLoggedToday } from "@/lib/today";
import { getNextDose } from "@/lib/next-dose";
import { getReorderStatus } from "@/lib/reorder";
import { getAnalyticsData } from "@/lib/analytics";
import { getWearableWindow } from "@/lib/wearable";
import { daysBetween, startOfDay } from "@/lib/schedule/schedule";
import { parseSchedule, cyclePosition } from "@/lib/schedule/entries";
import { scheduleTokenInfo } from "@/lib/schedule/token";
import { MetricTile } from "@/components/dashboard/MetricTile";
import { ProtocolTimingTile } from "@/components/dashboard/ProtocolTimingTile";
import { AdherenceTacho } from "@/components/dashboard/AdherenceTacho";
import { SupplyTile } from "@/components/dashboard/SupplyTile";
import { PlasmaMiniTile } from "@/components/dashboard/PlasmaMiniTile";
import { WellnessTile } from "@/components/dashboard/WellnessTile";
import { wellnessTrend } from "@/lib/wellness";
import { TodaySummaryTile } from "@/components/dashboard/TodaySummaryTile";
import { activeDesign, brandName } from "@/lib/design";
import { APP_VERSION } from "@/lib/version";
import { PitstopHeading } from "@/components/PitstopHeading";
import { PAGE_MAIN } from "@/lib/layout";

export const dynamic = "force-dynamic";

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** ISO-8601 week number (weeks start Monday; week 1 contains the first Thursday). */
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Thursday of the current week determines the ISO year/week.
  const day = (t.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  return 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

/** Memoised analytics reader — safe to call from a nested async RSC. */
const cachedAnalytics = cache(getAnalyticsData);

/**
 * Nested async RSC for the heavy analytics tiles.
 * Wrapped in Suspense from the parent so the dose section renders first.
 */
async function AnalyticsTiles({ userId, design }: { userId: string; design: "pitstop" | "current" }) {
  const data = await cachedAnalytics(userId);

  // Plasma mini-tile: peptide with the most-recent dose.
  // plasmaByPeptide is sorted alphabetically; we pick by most-recent takenAt.
  const mostRecentLog = await prisma.doseLog.findFirst({
    where: { userId },
    orderBy: { takenAt: "desc" },
    select: { preparation: { select: { vial: { select: { peptideId: true } } } } },
  });
  const mostRecentPeptideId = mostRecentLog?.preparation?.vial?.peptideId ?? null;

  // NOTE: AdherenceResult exposes `adherencePct` (already 0–100), NOT `.rate`.
  // Do not multiply by 100.
  const pct = data.overallAdherence.adherencePct != null
    ? `${Math.round(data.overallAdherence.adherencePct)}%`
    : "—";

  return (
    <>
      {design === "pitstop" ? (
        <AdherenceTacho pct={data.overallAdherence.adherencePct} />
      ) : (
        <MetricTile
          label="Adherence (90 days)"
          value={pct}
          href="/analytics"
          design={design}
          delta={pct === "100%" ? { text: "◆ best", tone: "best" } : undefined}
        />
      )}
      {/* Plasma chart: shown inline (under the stat tiles) up to 1900px. At
          ≥1900px it is hidden here and rendered in the right column instead, so
          the ultra-wide layout fills both columns rather than leaving a dead
          zone. Mobile/laptop render is unchanged (the bp class is inert below
          1900px). */}
      {data.plasmaByPeptide.length > 0 && (
        <div className="col-span-2 min-[1900px]:hidden lg:col-span-3">
          <PlasmaMiniTile
            plasmaByPeptide={data.plasmaByPeptide}
            mostRecentPeptideId={mostRecentPeptideId}
            now={data.now}
            design={design}
            missedDoses={data.missedDoseTimes}
          />
        </div>
      )}
    </>
  );
}

function AnalyticsSkeleton() {
  return (
    <>
      <div className="h-20 animate-pulse rounded-card bg-surface ring-1 ring-line/10" />
      <div className="col-span-2 h-32 animate-pulse rounded-card bg-surface ring-1 ring-line/10 lg:col-span-3" />
    </>
  );
}

/**
 * Standalone plasma chart for the ultra-wide right column (≥1900px only). Reads
 * the React-cached analytics (cachedAnalytics) so there is no extra DB cost over
 * the inline copy in AnalyticsTiles. Returns null when there is no plasma data.
 */
async function PlasmaSection({ userId, design }: { userId: string; design: "pitstop" | "current" }) {
  const data = await cachedAnalytics(userId);
  if (data.plasmaByPeptide.length === 0) return null;

  const mostRecentLog = await prisma.doseLog.findFirst({
    where: { userId },
    orderBy: { takenAt: "desc" },
    select: { preparation: { select: { vial: { select: { peptideId: true } } } } },
  });
  const mostRecentPeptideId = mostRecentLog?.preparation?.vial?.peptideId ?? null;

  return (
    <PlasmaMiniTile
      plasmaByPeptide={data.plasmaByPeptide}
      mostRecentPeptideId={mostRecentPeptideId}
      now={data.now}
      design={design}
      missedDoses={data.missedDoseTimes}
    />
  );
}

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-4 text-muted">
          No owner account yet. Run <code className="rounded bg-surface px-1">npm run db:seed</code> to load your regimen.
        </p>
      </main>
    );
  }

  // Active design pack (server-side env read) — surfaced to the wellness tile so
  // its pitstop branch can render Apex-Line recovery gauges. Client components
  // never read process.env; the design flows in as a plain prop.
  const design = activeDesign();

  // Dashboard always summarises TODAY; the day-nav + full list live on /today.
  const viewDate = new Date();

  // ~30-day wearable window for the latest recovery snapshot (local-midnight rows).
  const wearFrom = startOfDay(new Date(viewDate));
  wearFrom.setDate(wearFrom.getDate() - 30);

  // Cheap data — fetched before render, never delayed by analytics.
  const [due, logged, reorderItems, journalEntries, wearable, upcomingDose] = await Promise.all([
    getTodayDoses(user.id, viewDate),
    getLoggedToday(user.id, viewDate),
    getReorderStatus(user.id),
    prisma.journalEntry.findMany({ where: { userId: user.id }, orderBy: { date: "desc" }, take: 30 }),
    getWearableWindow(user.id, wearFrom, viewDate),
    getNextDose(user.id, viewDate),
  ]);
  const wellness = wellnessTrend(journalEntries, viewDate);

  // Today summary for the tile: remaining to take, logged count, next dose.
  const remaining = due.filter((d) => !d.alreadyLoggedToday);
  const nextDue = remaining[0];
  const nextLabel = nextDue
    ? `${nextDue.peptideName}${nextDue.time ? ` · ${nextDue.time}` : ""}`
    : null;

  // Next upcoming dose (across active protocols, next 30 days) — only surfaced
  // in the Today tile's EMPTY state, so it's height-neutral on the phone PWA.
  const nextDoseForTile = upcomingDose
    ? { peptideName: upcomingDose.peptideName, atISO: upcomingDose.at.toISOString() }
    : null;

  // Cycle-day / protocol-day tile label.
  // Find the active protocol with a startDate. If it has a cycle entry, use
  // cyclePosition; otherwise fall back to "Protocol day N" using daysBetween.
  // Most-recently-STARTED protocol that is genuinely RUNNING today, for the
  // Cycle tile. Excludes: non-active status (paused/completed/archived);
  // not-yet-started protocols (startDate in the future — e.g. a stack whose
  // start date was set ahead, which otherwise made daysBetween negative and
  // wrongly showed "No active protocol"); and COMPLETED protocols whose endDate
  // has already passed (endDate before today). A null endDate = open-ended.
  const activeProtocols = await prisma.protocol.findMany({
    where: {
      userId: user.id,
      status: "active",
      startDate: { not: null, lte: viewDate },
      OR: [{ endDate: null }, { endDate: { gte: startOfDay(viewDate) } }],
    },
    orderBy: { startDate: "desc" },
    include: { peptide: { select: { name: true } } },
  });
  const activeProtocol = activeProtocols[0] ?? null;

  // Running protocols for the pitstop Cycle timing-board. Distinct from the
  // Day-N query above: it must ALSO include active protocols with a null
  // startDate (e.g. a stack component — createStack never sets startDate), which
  // are genuinely running but have no Day-N anchor. A null startDate counts as
  // "started"; a null endDate is open-ended.
  const runningProtocols = await prisma.protocol.findMany({
    where: {
      userId: user.id,
      status: "active",
      OR: [{ startDate: null }, { startDate: { lte: viewDate } }],
      AND: [{ OR: [{ endDate: null }, { endDate: { gte: startOfDay(viewDate) } }] }],
    },
    orderBy: [{ startDate: "asc" }, { name: "asc" }],
    include: { peptide: { select: { name: true } } },
  });
  // Pit timing-board rows for the pitstop Cycle tile: each running protocol + its
  // compact schedule token. Count label ("N active") tracks this list length.
  const protocolRows = runningProtocols.map((p) => ({ id: p.id, name: p.peptide.name, ...scheduleTokenInfo(p.scheduleRule) }));

  let cycleDayLabel: string | null = null;
  let cycleDaySub: string | null = null;
  if (activeProtocol?.startDate) {
    const schedule = parseSchedule(activeProtocol.scheduleRule);
    const cycleEntry = schedule.find((e) => e.dayPattern.kind === "cycle");
    if (cycleEntry && cycleEntry.dayPattern.kind === "cycle") {
      const pos = cyclePosition(
        activeProtocol.startDate,
        cycleEntry.dayPattern.onDays,
        cycleEntry.dayPattern.offDays,
        viewDate,
      );
      if (pos) {
        cycleDayLabel = `Day ${pos.dayOfPhase}`;
        cycleDaySub = `${pos.phase === "on" ? "On" : "Off"} · ${pos.phaseDays}-day phase`;
      }
    } else {
      // Non-cycle protocol: linear day count from startDate.
      const n = daysBetween(startOfDay(activeProtocol.startDate), startOfDay(viewDate)) + 1;
      if (n >= 1) {
        cycleDayLabel = `Day ${n}`;
        cycleDaySub = "Protocol day";
      }
    }
  }

  // Page header date string.
  const dateLabel = viewDate.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Pitstop telemetry date sub-line: "TUE · 23 JUN 2026 · WK 26".
  const pitWeekday = viewDate.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  const pitMonth = viewDate.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  const pitDateLabel = `${pitWeekday} · ${viewDate.getDate()} ${pitMonth} ${viewDate.getFullYear()} · WK ${String(isoWeek(viewDate)).padStart(2, "0")}`;

  // Soonest reorder item (getReorderStatus returns reorder_now first, then soonest date).
  const soonestReorder = reorderItems[0] ?? null;

  return (
    <main className={PAGE_MAIN}>
      {/* Page header */}
      <header className="mb-6">
        <PitstopHeading title="Dashboard" index={1} design={design} className="text-3xl font-semibold tracking-tight" split={["DASH", "BOARD"]} />
        {design === "pitstop" ? (
          <p className="mt-0.5 font-mono uppercase tracking-[0.16em] text-[11px] text-muted">{pitDateLabel}</p>
        ) : (
          <p className="mt-0.5 text-sm text-muted">{dateLabel}</p>
        )}
      </header>

      {/* Ultra-wide two-column body. Below 1900px this wrapper is a plain block
          (no grid classes apply) so the children stack exactly as before:
          Today, stats, plasma, Recovery. At ≥1900px it becomes a balanced 2-col
          grid — LEFT column = Today + stat tiles + Recovery (stacked), RIGHT
          column = the plasma chart on its own, enlarged to fill the width. The
          inline plasma in the stat grid is hidden at ≥1900px; the Recovery tile
          sits in the left column at every width. Both wrappers are inert below
          1900px. */}
      <div className="min-[1900px]:grid min-[1900px]:grid-cols-[minmax(0,1fr)_minmax(0,860px)] min-[1900px]:gap-6 min-[1900px]:items-start">
        {/* Left column — Today + summary tiles + Recovery */}
        <div className="min-w-0">
          {/* Today summary — compact, links to the full /today page */}
          <TodaySummaryTile dueCount={remaining.length} loggedCount={logged.length} nextLabel={nextLabel} nextDose={nextDoseForTile} design={design} />

          {/* Summary tile grid — 2-up on mobile, 3-up on desktop. grid-flow-dense
              lets the pitstop Cycle timing-board span both columns on mobile
              without leaving a gap (Supply + Adherence backfill the top row). */}
          <div className="mb-6 grid grid-flow-row-dense grid-cols-2 gap-3 max-[640px]:mb-3 max-[640px]:gap-2 lg:grid-cols-3">
            {/* Supply tile — cheap, renders immediately */}
            <SupplyTile item={soonestReorder} design={design} />

            {/* Cycle tile. Pitstop: a pit timing-board of active protocols +
                schedules (full-width on mobile, single cell at lg). Current
                design keeps the single "Day N" cycle readout. */}
            {design === "pitstop" ? (
              <div className="col-span-2 lg:col-span-1">
                <ProtocolTimingTile protocols={protocolRows} />
              </div>
            ) : cycleDayLabel ? (
              <MetricTile
                label="Cycle"
                value={cycleDayLabel}
                sub={cycleDaySub ?? undefined}
                design={design}
                delta={cycleDaySub?.includes("On") ? { text: "▲ on plan", tone: "up" } : undefined}
              />
            ) : (
              <div className="h-full rounded-card bg-surface p-4 ring-1 ring-line/10 shadow-sm">
                <p className="text-xs font-medium text-muted">Cycle</p>
                <p className="mt-1 text-sm text-muted">No active protocol</p>
              </div>
            )}

            {/* Analytics tiles — Suspense-wrapped; never blocks dose section */}
            <Suspense fallback={<AnalyticsSkeleton />}>
              <AnalyticsTiles userId={user.id} design={design} />
            </Suspense>
          </div>

          {/* Recovery (wellness) tile — lives in the left column under the stats
              at every width. mt-6 (mt-3 on phone) reproduces the original gap
              that previously sat above the right rail, so mobile/laptop stacking
              stays byte-identical: Today, stats, plasma, Recovery. */}
          <div className="mt-6 max-[640px]:mt-3">
            <WellnessTile trend={wellness} snapshot={wearable.latestSnapshot} design={design} />
          </div>
        </div>

        {/* Right column — the plasma chart on its own, enlarged, ONLY at ≥1900px
            (the inline copy in the stat grid is hidden at that width). Empty and
            inert below 1900px (plasma shows inline in the left column there), so
            it adds no stray spacing on mobile/laptop. */}
        <div className="min-w-0">
          <div className="hidden min-[1900px]:block">
            <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-surface ring-1 ring-line/10" />}>
              <PlasmaSection userId={user.id} design={design} />
            </Suspense>
          </div>
        </div>
      </div>

      <p className="mt-8 text-center text-xs text-muted max-[640px]:mt-3 lg:hidden">{brandName()} · not medical advice · v{APP_VERSION}</p>
    </main>
  );
}
