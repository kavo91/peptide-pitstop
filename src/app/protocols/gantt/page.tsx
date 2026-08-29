import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { BackButton } from "@/components/BackButton";
import { PitstopHeading } from "@/components/PitstopHeading";
import { SignedOutNotice } from "@/components/SignedOutNotice";
import { GanttRowEditor } from "@/components/GanttRowEditor";
import { PAGE_MAIN } from "@/lib/layout";
import { startOfDay } from "@/lib/schedule/schedule";
import { fmtCycleDay } from "@/lib/cycle/format";
import { cycleChip } from "@/lib/cycle/label";
import { bucketOf, PROTOCOL_SECTIONS } from "@/lib/protocol-bucket";
import {
  ganttWindow,
  ganttRow,
  segmentPercents,
  dayCentrePercent,
  concurrencyByDay,
  weekTicks,
  type GanttRow,
  type GanttSegmentKind,
} from "@/lib/protocol-gantt";

export const dynamic = "force-dynamic";

/**
 * The planner: every course as an aligned bar, so concurrent exposure reads
 * vertically. Bars are server-rendered geometry from lib/protocol-gantt; the
 * only client surface is the per-row editor for cycles and end dates.
 */

const SEG_LABEL: Record<GanttSegmentKind, string> = {
  on: "On",
  off: "Break",
  projected: "Projected",
};

const SEG_CLASS: Record<GanttSegmentKind, string> = {
  on: "bg-accent",
  off: "bg-line/20",
  projected: "bg-accent/25 ring-1 ring-inset ring-accent/50",
};

const ROW_TONE: Record<GanttRow["status"], string> = {
  active: "",
  paused: "opacity-50",
  completed: "opacity-40 grayscale",
};

function toDateInput(d: Date | null): string | null {
  if (!d) return null;
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Local-calendar yyyy-mm-dd for LIB-COMPUTED dates (segments, ticks). These
 * are local Dates from startOfDay/addDays — toISOString() would shift them a
 * day back for any TZ ahead of UTC. Stored Convention-1 columns (the editor
 * props above) keep the UTC slice, matching /protocols.
 */
function localDay(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default async function ProtocolGanttPage() {
  const user = await getCurrentUser();
  if (!user) return <SignedOutNotice />;

  const protocols = await prisma.protocol.findMany({
    where: { userId: user.id },
    include: { peptide: true },
    orderBy: { name: "asc" },
  });

  const today = startOfDay(new Date());
  const window = ganttWindow(today);
  const bucketRank = new Map(PROTOCOL_SECTIONS.map((s, i) => [s.key, i]));

  const rows = protocols
    .map((p) => ({
      p,
      row: ganttRow(
        {
          id: p.id,
          name: p.name,
          peptideName: p.peptide.name,
          status: p.status,
          startDate: p.startDate,
          endDate: p.endDate,
          cycleAnchor: p.cycleAnchor,
          cycleOnWeeks: p.cycleOnWeeks,
          cycleOffWeeks: p.cycleOffWeeks,
        },
        window,
        today,
      ),
    }))
    .filter((x): x is typeof x & { row: GanttRow } => x.row !== null)
    .sort((a, b) => {
      const ra = bucketRank.get(bucketOf(a.p, today)) ?? 9;
      const rb = bucketRank.get(bucketOf(b.p, today)) ?? 9;
      if (ra !== rb) return ra - rb;
      return a.row.peptideName.localeCompare(b.row.peptideName);
    });

  const counts = concurrencyByDay(rows.map((x) => x.row), window);
  const maxCount = Math.max(1, ...counts);
  const runningToday = rows.filter((x) => x.row.onToday).length;
  const ticks = weekTicks(window);
  const todayPct = dayCentrePercent(window, today);

  return (
    <main className={PAGE_MAIN}>
      <BackButton fallback="/protocols" />
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <PitstopHeading title="Gantt" index={8} className="text-3xl font-semibold tracking-tight" split={["GAN", "TT"]} />
          <p className="text-muted">
            What runs together, and when — edit cycles and end dates in place.
          </p>
        </div>
        <Link href="/protocols" className="shrink-0 rounded-control bg-bg px-3 py-2 text-sm ring-1 ring-line/15">
          List view
        </Link>
      </div>

      {/* Legend + today summary */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-accent" aria-hidden /> on</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-line/20" aria-hidden /> break</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-accent/25 ring-1 ring-inset ring-accent/50" aria-hidden /> projected restart</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-px bg-danger" aria-hidden /> today</span>
        <span className="ml-auto font-medium text-ink">{runningToday} running today</span>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-card bg-surface p-6 text-sm text-muted ring-1 ring-line/10">
          Nothing to plot — no protocol overlaps the next {Math.round(window.days / 7)} weeks.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
          <div className="min-w-[720px]">
            {/* Axis */}
            <div className="flex items-end gap-3 pb-1">
              <div className="w-40 shrink-0 md:w-48" />
              <div className="relative h-5 flex-1 text-[10px] text-muted">
                {ticks.map((t, i) =>
                  i % 2 === 0 ? (
                    <span
                      key={t.toISOString()}
                      className="absolute -translate-x-1/2 whitespace-nowrap"
                      style={{ left: `${(i * 7 * 100) / window.days}%` }}
                    >
                      {fmtCycleDay(t)}
                    </span>
                  ) : null,
                )}
                <span
                  className="absolute -translate-x-1/2 font-medium text-danger"
                  style={{ left: `${todayPct}%`, top: "100%" }}
                >
                  ▾
                </span>
              </div>
            </div>

            {/* Concurrency strip — committed + projected exposure per day */}
            <div className="flex items-center gap-3 pb-3 pt-2">
              <div className="w-40 shrink-0 text-xs text-muted md:w-48">Taken together</div>
              <div
                className="flex h-5 flex-1 overflow-hidden rounded-sm bg-bg ring-1 ring-line/10"
                data-testid="concurrency-strip"
              >
                {counts.map((c, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-accent"
                    style={{ opacity: c === 0 ? 0 : 0.2 + (0.8 * c) / maxCount }}
                    title={`${fmtCycleDay(new Date(window.start.getTime() + i * 86_400_000))} — ${c} running`}
                  />
                ))}
              </div>
            </div>

            {/* One row per course */}
            {rows.map(({ p, row }) => (
              <div key={row.id} className="border-t border-line/10 py-2" data-gantt-row={row.peptideName}>
                <div className="flex items-center gap-3">
                  <div className="w-40 shrink-0 md:w-48">
                    <p className="truncate text-sm font-medium text-ink">
                      {row.peptideName}
                      {row.onToday && <span className="ml-1.5 align-middle text-[10px] text-ok">● now</span>}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {row.name}
                      {row.status !== "active" && <span className="ml-1 capitalize">· {row.status}</span>}
                      {row.openEnded && <span className="ml-1">· no end date</span>}
                    </p>
                    {(() => {
                      const chip = cycleChip({
                        anchor: p.cycleAnchor ?? p.startDate,
                        onWeeks: p.cycleOnWeeks,
                        offWeeks: p.cycleOffWeeks,
                        today,
                      });
                      return chip ? <p className="truncate text-[10px] text-muted">{chip.text}</p> : null;
                    })()}
                  </div>
                  <div className={`relative h-7 flex-1 ${ROW_TONE[row.status]}`}>
                    {/* Week gridlines */}
                    {ticks.map((t, i) => (
                      <span
                        key={t.toISOString()}
                        className="absolute inset-y-0 w-px bg-line/10"
                        style={{ left: `${(i * 7 * 100) / window.days}%` }}
                        aria-hidden
                      />
                    ))}
                    {/* Segments */}
                    {row.segments.map((seg) => {
                      const { left, width } = segmentPercents(window, seg);
                      return (
                        <span
                          key={`${seg.kind}:${seg.from.toISOString()}`}
                          className={`absolute inset-y-1 rounded-sm ${SEG_CLASS[seg.kind]}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          data-kind={seg.kind}
                          data-from={localDay(seg.from)}
                          data-to={localDay(seg.to)}
                          title={`${SEG_LABEL[seg.kind]} ${fmtCycleDay(seg.from)} – ${fmtCycleDay(seg.to)}`}
                        />
                      );
                    })}
                    {/* Today line */}
                    <span
                      className="absolute inset-y-0 w-px bg-danger/70"
                      style={{ left: `${todayPct}%` }}
                      aria-hidden
                    />
                  </div>
                </div>
                <GanttRowEditor
                  key={`${row.id}:${toDateInput(p.endDate) ?? ""}:${p.cycleOnWeeks ?? ""}:${p.cycleOffWeeks ?? ""}:${toDateInput(p.cycleAnchor) ?? ""}`}
                  id={row.id}
                  name={row.name}
                  endDate={toDateInput(p.endDate)}
                  cycleOnWeeks={p.cycleOnWeeks}
                  cycleOffWeeks={p.cycleOffWeeks}
                  cycleAnchor={toDateInput(p.cycleAnchor)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-muted">
        Projected blocks show a repeating cycle&apos;s pattern past its committed end date — they
        happen only when the next cycle is actually started. Schedule rules and titration steps
        stay on the protocol form.
      </p>
    </main>
  );
}
