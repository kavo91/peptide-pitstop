/**
 * Training card — the Fenix-era training metrics from the wearable `training`
 * series. Top: the latest value of each metric as a compact stat grid (Garmin's
 * own words for the readiness level, ACWR status and training status — never
 * re-judged here). Below: two small panels, readiness (0–100) and the
 * acute:chronic workload ratio, one scale each (never a dual axis).
 * Pure presentational server component.
 */
import type { TrainingPoint } from "@/lib/wearable-series";
import { buildLinePath, extent, formatDayKeyShort, paceFromSpeed, type XY } from "@/lib/wearable-chart";
import { ChartCard, ChartEmpty, Legend } from "./chart-ui";

const WIDTH = 600;
const PANEL_H = 110;
const PAD = { top: 12, right: 30, bottom: 24, left: 30 };

const COL = {
  readiness: "rgb(var(--accent))",
  acwr: "rgb(var(--accent-2-strong))",
};

function mapX(i: number, n: number): number {
  const chartW = WIDTH - PAD.left - PAD.right;
  const step = chartW / Math.max(n, 1);
  return PAD.left + step * i + step / 2;
}

function mapY(v: number, lo: number, hi: number): number {
  const chartH = PANEL_H - PAD.top - PAD.bottom;
  const range = hi - lo || 1;
  return PAD.top + (1 - (v - lo) / range) * chartH;
}

/** Last non-null value in a series (the series is oldest → newest). */
function last<T>(values: (T | null | undefined)[]): T | null {
  for (let i = values.length - 1; i >= 0; i--) { const v = values[i]; if (v != null) return v; }
  return null;
}

/** Garmin's readiness / status words, printed as they come but in sentence case. */
function word(s: string | null): string | null {
  if (!s) return null;
  const w = s.replace(/_/g, " ").toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function Stat({ k, v, sub }: { k: string; v: string; sub?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{k}</dt>
      {/* No `truncate`: a long pair like "162 bpm 4:46 /km" must wrap inside its grid
          cell, never clip — a half-printed number on a health surface is a defect.
          Each part is nowrap so a wrap falls BETWEEN them ("162 bpm" / "4:46 /km"),
          never inside one ("162" / "bpm 4:46 /km"). */}
      <dd className="flex flex-wrap items-baseline gap-x-1 text-sm font-semibold tabular-nums text-ink">
        <span className="whitespace-nowrap">{v}</span>
        {sub ? <span className="whitespace-nowrap text-xs font-normal text-muted">{sub}</span> : null}
      </dd>
    </div>
  );
}

function Panel({ title, points, color, lo, hi, digits }: { title: string; points: (number | null)[]; color: string; lo: number; hi: number; digits: number }) {
  const n = points.length;
  const xy: (XY | null)[] = points.map((v, i) => (v == null ? null : { x: mapX(i, n), y: mapY(v, lo, hi) }));
  const path = buildLinePath(xy);
  const lastIdx = (() => { for (let i = n - 1; i >= 0; i--) if (points[i] != null) return i; return -1; })();
  return (
    <svg viewBox={`0 0 ${WIDTH} ${PANEL_H}`} className="w-full" style={{ height: "auto" }} aria-label={`${title}, ${n} day(s)`}>
      <text x={PAD.left - 4} y={PAD.top + 4} textAnchor="end" fontSize={9} className="fill-muted tabular-nums">{hi.toFixed(digits)}</text>
      <text x={PAD.left - 4} y={PANEL_H - PAD.bottom} textAnchor="end" fontSize={9} className="fill-muted tabular-nums">{lo.toFixed(digits)}</text>
      <line x1={PAD.left} x2={WIDTH - PAD.right} y1={PANEL_H - PAD.bottom} y2={PANEL_H - PAD.bottom} className="stroke-line/20" strokeWidth={1} />
      {path && <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
      {xy.map((p, i) => (p ? <circle key={i} cx={p.x} cy={p.y} r={i === lastIdx ? 4 : 2.5} fill={color} className="stroke-surface" strokeWidth={i === lastIdx ? 2 : 1} /> : null))}
      {lastIdx >= 0 && xy[lastIdx] && (
        <text x={Math.min(xy[lastIdx]!.x + 8, WIDTH - PAD.right + 26)} y={xy[lastIdx]!.y + 3} fontSize={10} className="fill-ink tabular-nums font-medium">{points[lastIdx]!.toFixed(digits)}</text>
      )}
    </svg>
  );
}

export function TrainingChart({ training, detailHref }: { training: TrainingPoint[]; detailHref?: string }) {
  const n = training.length;
  const readiness = training.map((t) => t.readiness);
  const acwr = training.map((t) => t.acwr);
  const hasAny = training.some((t) => t.readiness != null || t.acwr != null || t.enduranceScore != null || t.hillScore != null || t.fitnessAge != null || t.ltHr != null || t.floorsClimbed != null || t.restingHr7d != null);
  const asOf = last(training.filter((t) => t.readiness != null || t.acwr != null).map((t) => t.date));

  const latestReadiness = last(readiness);
  const latestLevel = word(last(training.map((t) => t.readinessLevel)));
  const latestAcwr = last(acwr);
  const latestAcwrStatus = word(last(training.map((t) => t.acwrStatus)));
  const latestStatus = word(last(training.map((t) => t.trainingStatus)));
  const latestEndurance = last(training.map((t) => t.enduranceScore));
  const latestHill = last(training.map((t) => t.hillScore));
  const latestFitnessAge = last(training.map((t) => t.fitnessAge));
  const latestLtHr = last(training.map((t) => t.ltHr));
  // `ltSpeedMs` is already true m/s (the normaliser converts Garmin's tenth-of-m/s field).
  const latestLtPace = paceFromSpeed(last(training.map((t) => t.ltSpeedMs)));
  const latestFloors = last(training.map((t) => t.floorsClimbed));
  const latestRhr7d = last(training.map((t) => t.restingHr7d));
  const acute = last(training.map((t) => t.acuteLoad));
  const chronic = last(training.map((t) => t.chronicLoad));

  const acwrRange = (() => { const ex = extent(acwr); if (!ex) return null; return { lo: Math.min(0.5, Math.floor(ex.min * 10) / 10), hi: Math.max(1.5, Math.ceil(ex.max * 10) / 10) }; })();

  return (
    <ChartCard title="Training" sub={asOf ? `as of ${formatDayKeyShort(asOf)}` : undefined} href={detailHref}>
      {!hasAny ? (
        <ChartEmpty />
      ) : (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Stat k="Readiness" v={latestReadiness == null ? "—" : String(latestReadiness)} sub={latestLevel} />
            <Stat k="Load ratio" v={latestAcwr == null ? "—" : latestAcwr.toFixed(2)} sub={latestAcwrStatus} />
            <Stat k="Load 7 d / 28 d" v={acute == null && chronic == null ? "—" : `${acute ?? "—"} / ${chronic ?? "—"}`} />
            <Stat k="Status" v={latestStatus ?? "—"} />
            <Stat k="Endurance" v={latestEndurance == null ? "—" : String(latestEndurance)} />
            <Stat k="Hill" v={latestHill == null ? "—" : String(latestHill)} />
            <Stat k="Fitness age" v={latestFitnessAge == null ? "—" : latestFitnessAge.toFixed(1)} />
            <Stat k="Threshold" v={latestLtHr == null ? "—" : `${latestLtHr} bpm`} sub={latestLtPace} />
            <Stat k="Floors" v={latestFloors == null ? "—" : String(latestFloors)} />
            <Stat k="Resting HR 7 d" v={latestRhr7d == null ? "—" : `${latestRhr7d} bpm`} />
          </dl>

          {readiness.some((v) => v != null) && (
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">Readiness · {n} d</p>
              <Panel title="Training readiness" points={readiness} color={COL.readiness} lo={0} hi={100} digits={0} />
            </div>
          )}
          {acwrRange && (
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">Acute : chronic load · {n} d</p>
              <Panel title="Acute to chronic workload ratio" points={acwr} color={COL.acwr} lo={acwrRange.lo} hi={acwrRange.hi} digits={2} />
            </div>
          )}
          <Legend items={[{ label: "readiness 0–100", color: COL.readiness, line: true }, { label: "load ratio", color: COL.acwr, line: true }]} />
          <p className="text-[10px] text-muted">Scores and words are Garmin&apos;s own. The app prints them; it does not re-judge them.</p>
        </div>
      )}
    </ChartCard>
  );
}
