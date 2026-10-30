/**
 * Eight Sleep night temperature — bed and room temperature across ONE night,
 * from the readings in the night's stored timeseries (a Pod sends them about
 * hourly; dots are drawn up to MAX_DOTS readings a line, and always for a
 * reading the line cannot reach). ‹ › move between the
 * stored Eight Sleep nights via `?night=`. The legend's figure is the mean of
 * these readings, not Eight Sleep's own night average shown in the bed card.
 * A gap of more than GAP_MS between two readings breaks the line rather than
 * bridging it. Pure presentational server component; clock labels use `timeZone`
 * (the viewer's zone, else the runtime's). Neutral tracking only — no advice.
 */
import Link from "next/link";
import type { NightTemps, TempPoint } from "@/lib/eight-sleep-night-temps";
import { meanTemp } from "@/lib/eight-sleep-night-temps";
import { buildLinePath, formatDayKeyShort } from "@/lib/wearable-chart";
import { ChartCard, Legend } from "./chart-ui";

const WIDTH = 600;
const HEIGHT = 220;
const PAD = { top: 14, right: 16, bottom: 26, left: 40 };
const GAP_MS = 90 * 60 * 1000;
const MAX_DOTS = 30;

const BED = "rgb(var(--accent))";
const ROOM = "rgb(var(--accent-2-strong))";

export interface NightNav {
  night: string;
  prev: string | null;
  next: string | null;
  href: (night: string) => string;
}

/** A reading with a gap (or the end of the night) on both sides draws no line, so it always gets a dot. */
function isolated(pts: TempPoint[], i: number): boolean {
  const before = i === 0 || pts[i].t - pts[i - 1].t > GAP_MS;
  const after = i === pts.length - 1 || pts[i + 1].t - pts[i].t > GAP_MS;
  return before && after;
}

function clock(t: number, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(t));
}

function NightLinks({ nav }: { nav: NightNav }) {
  const cls = "rounded px-2 py-0.5 text-xs font-medium text-accentStrong hover:underline";
  return (
    <div className="mb-2 flex items-center justify-between text-xs text-muted">
      {nav.prev ? (
        <Link href={nav.href(nav.prev)} className={cls} aria-label="Previous night">‹ {formatDayKeyShort(nav.prev)}</Link>
      ) : (
        <span />
      )}
      {nav.next ? (
        <Link href={nav.href(nav.next)} className={cls} aria-label="Next night">{formatDayKeyShort(nav.next)} ›</Link>
      ) : (
        <span />
      )}
    </div>
  );
}

export function EightSleepNightTempChart({
  temps,
  nav,
  timeZone,
}: {
  temps: NightTemps | null;
  nav: NightNav;
  timeZone?: string;
}) {
  const title = "Night temperature · Eight Sleep";
  const sub = formatDayKeyShort(nav.night);
  const all = temps ? [...temps.bed, ...temps.room] : [];

  if (!temps || all.length === 0) {
    return (
      <ChartCard title={title} sub={sub}>
        <NightLinks nav={nav} />
        <p className="py-6 text-center text-sm text-muted">No temperature readings for this night.</p>
      </ChartCard>
    );
  }

  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  const lo = Math.floor(Math.min(...all.map((p) => p.v)) - 0.5);
  const hi = Math.ceil(Math.max(...all.map((p) => p.v)) + 0.5);
  const chartW = WIDTH - PAD.left - PAD.right;
  const chartH = HEIGHT - PAD.top - PAD.bottom;
  const bottomY = HEIGHT - PAD.bottom;
  const x = (t: number) => PAD.left + (t1 > t0 ? ((t - t0) / (t1 - t0)) * chartW : chartW / 2);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * chartH;

  const path = (pts: TempPoint[]) =>
    buildLinePath(pts.flatMap((p, i) => (i > 0 && p.t - pts[i - 1].t > GAP_MS ? [null, { x: x(p.t), y: y(p.v) }] : [{ x: x(p.t), y: y(p.v) }])));

  const lines = [
    { key: "bed", label: "Bed", color: BED, pts: temps.bed },
    { key: "room", label: "Room", color: ROOM, pts: temps.room },
  ].filter((l) => l.pts.length);

  return (
    <ChartCard title={title} sub={sub}>
      <NightLinks nav={nav} />
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-label="Bed and room temperature across the night" className="w-full" style={{ height: "auto" }}>
        <text x={PAD.left - 6} y={PAD.top + 3} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{hi} °C</text>
        <text x={PAD.left - 6} y={bottomY} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{lo} °C</text>
        <line x1={PAD.left} y1={bottomY} x2={WIDTH - PAD.right} y2={bottomY} stroke="rgb(var(--muted))" strokeWidth="0.5" strokeOpacity="0.4" />

        {lines.map((l) => (
          <g key={l.key}>
            <path d={path(l.pts)} fill="none" stroke={l.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            {l.pts.map((p, i) => (l.pts.length > MAX_DOTS && !isolated(l.pts, i) ? null : (
              <circle key={`${p.t}-${i}`} cx={x(p.t).toFixed(1)} cy={y(p.v).toFixed(1)} r="2.5" fill={l.color}>
                <title>{`${l.label} ${p.v.toFixed(1)} °C at ${clock(p.t, timeZone)}`}</title>
              </circle>
            )))}
          </g>
        ))}

        <text x={PAD.left} y={HEIGHT - 8} fontSize="9" fill="rgb(var(--muted))">{clock(t0, timeZone)}</text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 8} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{clock(t1, timeZone)}</text>
      </svg>

      <Legend
        items={lines.map((l) => {
          const avg = meanTemp(l.pts);
          return { label: `${l.label}${avg != null ? ` · mean of readings ${avg.toFixed(1)} °C` : ""}`, color: l.color, line: true };
        })}
      />
      <p className="mt-1 text-[11px] text-muted">
        From your Eight Sleep: {lines.map((l) => `${l.pts.length} ${l.label.toLowerCase()} reading${l.pts.length === 1 ? "" : "s"}`).join(", ")} this night.
      </p>
    </ChartCard>
  );
}
