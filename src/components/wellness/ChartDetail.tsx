"use client";

/**
 * Chart-detail view. Default ("Overview") renders the SAME rich chart shown on
 * the journal page (e.g. Sleep = stacked Deep/Light/REM/Awake + Score), just
 * larger, with a time-range selector. Picking a single series switches to a
 * focused line with a smoothing toggle. The journal chart components are pure
 * (no server-only), so they render fine inside this client island. No refetch —
 * all refinement filters the server-provided 90-day series client-side.
 */
import { useState } from "react";
import type { WearableSeries } from "@/lib/wearable-series";
import {
  filterByRange,
  rollingAverage,
  type AggPoint,
  type Range,
} from "@/lib/wearable-aggregate";
import { extent, buildLinePath, formatDayKeyShort, type XY } from "@/lib/wearable-chart";
import type { ChartId, SeriesOption } from "@/lib/chart-detail-config";
import { ChartEmpty } from "./chart-ui";
import { SleepChart } from "./SleepChart";
import { RecoveryChart } from "./RecoveryChart";
import { BodyCompositionChart } from "./BodyCompositionChart";
import { ActivityChart } from "./ActivityChart";

const RANGES: Range[] = [7, 30, 90, "all"];

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-control px-2.5 py-1 text-xs font-medium ring-1 transition-colors ${
        active ? "bg-accent text-onAccent ring-transparent" : "bg-bg text-muted ring-line/15 hover:ring-line/30"
      }`}
    >
      {children}
    </button>
  );
}

/** The rich journal chart for `chart`, fed the range-filtered typed series. */
function Overview({ chart, series, range }: { chart: ChartId; series: WearableSeries; range: Range }) {
  switch (chart) {
    case "sleep":
      return <SleepChart sleep={filterByRange(series.sleep, range)} />;
    case "recovery":
      return <RecoveryChart recovery={filterByRange(series.recovery, range)} />;
    case "body":
      return <BodyCompositionChart weight={filterByRange(series.weight, range)} />;
    case "activity":
      return <ActivityChart activity={filterByRange(series.activity, range)} />;
  }
}

const W = 600;
const H = 300;
const PAD = { top: 16, right: 16, bottom: 28, left: 40 };

/** A single-metric focus line with optional 7-day smoothing. */
function FocusLine({ points }: { points: AggPoint[] }) {
  const values = points.map((p) => p.value);
  const ex = extent(values);
  if (!ex) return <ChartEmpty />;

  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const bottomY = H - PAD.bottom;
  const pad = (ex.max - ex.min) * 0.08 || 1;
  const yLo = ex.min - pad;
  const yHi = ex.max + pad;
  const yFor = (v: number) => bottomY - ((v - yLo) / (yHi - yLo)) * chartH;
  const xFor = (i: number) => PAD.left + (points.length <= 1 ? chartW / 2 : (i / (points.length - 1)) * chartW);
  const linePts: (XY | null)[] = points.map((p, i) => (p.value == null ? null : { x: xFor(i), y: yFor(p.value) }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} aria-label="Metric trend" className="w-full" style={{ height: "auto" }}>
      {[yLo, (yLo + yHi) / 2, yHi].map((g, i) => (
        <g key={i}>
          <line x1={PAD.left} y1={yFor(g)} x2={W - PAD.right} y2={yFor(g)} stroke="rgb(var(--muted))" strokeWidth="0.5" strokeOpacity="0.18" />
          <text x={PAD.left - 4} y={yFor(g) + 3} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{Math.round(g * 10) / 10}</text>
        </g>
      ))}
      <path d={buildLinePath(linePts)} fill="none" stroke="rgb(var(--accent))" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      {linePts.map((pt, i) => (pt ? <circle key={i} cx={pt.x.toFixed(1)} cy={pt.y.toFixed(1)} r="1.6" fill="rgb(var(--accent))" /> : null))}
      {points.length > 0 && (
        <>
          <text x={PAD.left} y={H - 8} fontSize="9" fill="rgb(var(--muted))">{formatDayKeyShort(points[0].date)}</text>
          <text x={W - PAD.right} y={H - 8} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{formatDayKeyShort(points[points.length - 1].date)}</text>
        </>
      )}
    </svg>
  );
}

export function ChartDetail({
  chart,
  series,
  options,
  data,
}: {
  chart: ChartId;
  series: WearableSeries;
  options: SeriesOption[];
  data: Record<string, AggPoint[]>;
}) {
  const [range, setRange] = useState<Range>(30);
  const [view, setView] = useState<"overview" | string>("overview");
  const [smooth, setSmooth] = useState(false);

  const focus = view !== "overview";
  const focusPoints = focus
    ? (() => {
        const windowed = filterByRange(data[view] ?? [], range);
        return smooth ? rollingAverage(windowed, 7) : windowed;
      })()
    : [];

  return (
    <div>
      <div className="mb-3 space-y-2">
        {/* View: the rich Overview, or focus a single metric. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill active={!focus} onClick={() => setView("overview")}>Overview</Pill>
          {options.length > 1 &&
            options.map((o) => (
              <Pill key={o.key} active={view === o.key} onClick={() => setView(o.key)}>
                {o.label}
              </Pill>
            ))}
        </div>
        {/* Time range, plus smoothing when focused on a single line. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {RANGES.map((r) => (
            <Pill key={String(r)} active={range === r} onClick={() => setRange(r)}>
              {r === "all" ? "All" : `${r}d`}
            </Pill>
          ))}
          {focus && (
            <>
              <span className="mx-1 h-4 w-px bg-line/15" />
              <Pill active={!smooth} onClick={() => setSmooth(false)}>Daily</Pill>
              <Pill active={smooth} onClick={() => setSmooth(true)}>7-day avg</Pill>
            </>
          )}
        </div>
      </div>

      {focus ? (
        <div className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
          <FocusLine points={focusPoints} />
        </div>
      ) : (
        <Overview chart={chart} series={series} range={range} />
      )}
    </div>
  );
}
