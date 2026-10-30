/**
 * Sleep chart for nights from two devices — Garmin and Eight Sleep side by side.
 * Each night gets two stacked stage bars (Garmin left, Eight Sleep right and
 * outlined) and each device keeps its own score line (Garmin solid, Eight Sleep
 * dashed). A night only one device recorded shows only that device's bar.
 * Nothing is blended: each bar and line is one device's own numbers.
 * Pure presentational server component fed by pairSleepNights().
 */
import type { SleepPair, DeviceNight } from "@/lib/sleep-pairs";
import { secondsToHours, average, formatDayKeyShort, buildLinePath } from "@/lib/wearable-chart";
import { ChartCard, ChartEmpty, Legend } from "./chart-ui";

const WIDTH = 600;
// Same height as SleepChart so the card still matches Recovery beside it.
const HEIGHT = 414;
const PAD = { top: 14, right: 30, bottom: 30, left: 30 };

const STAGES = [
  { key: "deep", label: "Deep", color: "rgb(var(--accent))", opacity: 0.95 },
  { key: "light", label: "Light", color: "rgb(var(--accent))", opacity: 0.4 },
  { key: "rem", label: "REM", color: "rgb(var(--accent-2-strong))", opacity: 0.75 },
  { key: "awake", label: "Awake", color: "rgb(var(--muted))", opacity: 0.5 },
] as const;

const EIGHT_OUTLINE = "rgb(var(--ink))";

function stageHours(n: DeviceNight | null) {
  const s = {
    deep: secondsToHours(n?.deep) ?? 0,
    light: secondsToHours(n?.light) ?? 0,
    rem: secondsToHours(n?.rem) ?? 0,
    awake: secondsToHours(n?.awake) ?? 0,
  };
  return { stages: s, total: s.deep + s.light + s.rem + s.awake };
}

function asleepHours(n: DeviceNight | null): number | null {
  return n?.asleep != null ? n.asleep / 3600 : null;
}

export function SleepPairChart({ pairs, detailHref }: { pairs: SleepPair[]; detailHref?: string }) {
  const nights = pairs.map((p) => ({
    date: p.date,
    garmin: { ...stageHours(p.garmin), score: p.garmin?.score ?? null },
    eight: { ...stageHours(p.eightSleep), score: p.eightSleep?.score ?? null },
  }));

  if (!nights.some((n) => n.garmin.total > 0 || n.eight.total > 0 || n.garmin.score != null || n.eight.score != null)) {
    return <ChartCard title="Sleep"><ChartEmpty /></ChartCard>;
  }

  const appleNights = pairs.filter((p) => p.garmin?.source === "healthkit").length;
  const avgG = average(pairs.map((p) => asleepHours(p.garmin)));
  const avgE = average(pairs.map((p) => asleepHours(p.eightSleep)));

  const chartW = WIDTH - PAD.left - PAD.right;
  const chartH = HEIGHT - PAD.top - PAD.bottom;
  const bottomY = HEIGHT - PAD.bottom;
  const axisMax = Math.max(1, Math.ceil(Math.max(...nights.flatMap((n) => [n.garmin.total, n.eight.total]), 0)));
  const step = chartW / Math.max(nights.length, 1);
  const barW = Math.min(step * 0.34, 13);
  const gap = Math.min(step * 0.04, 2);
  const scoreY = (s: number) => PAD.top + (1 - s / 100) * chartH;
  const centre = (i: number) => PAD.left + step * i + step / 2;

  const bar = (key: string, x: number, h: ReturnType<typeof stageHours>, outlined: boolean) => {
    if (h.total <= 0) return null;
    let cursor = bottomY;
    const fullH = (h.total / axisMax) * chartH;
    return (
      <g key={key}>
        {STAGES.map((s) => {
          const v = h.stages[s.key];
          if (v <= 0) return null;
          const barH = (v / axisMax) * chartH;
          cursor -= barH;
          return (
            <rect key={s.key} x={x.toFixed(1)} y={cursor.toFixed(1)} width={barW.toFixed(1)} height={barH.toFixed(1)} fill={s.color} fillOpacity={s.opacity} rx="1" />
          );
        })}
        {outlined && (
          <rect x={x.toFixed(1)} y={(bottomY - fullH).toFixed(1)} width={barW.toFixed(1)} height={fullH.toFixed(1)} fill="none" stroke={EIGHT_OUTLINE} strokeOpacity="0.55" strokeWidth="1" rx="1" />
        )}
      </g>
    );
  };

  const gPts = nights.map((n, i) => (n.garmin.score == null ? null : { x: centre(i) - gap / 2 - barW / 2, y: scoreY(n.garmin.score) }));
  const ePts = nights.map((n, i) => (n.eight.score == null ? null : { x: centre(i) + gap / 2 + barW / 2, y: scoreY(n.eight.score) }));

  return (
    <ChartCard
      title="Sleep"
      href={detailHref}
      sub={[avgG != null ? `Garmin ${avgG.toFixed(1)} h` : null, avgE != null ? `Eight Sleep ${avgE.toFixed(1)} h` : null]
        .filter(Boolean)
        .join(" · ")}
    >
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-label="Nightly sleep, Garmin and Eight Sleep side by side" className="w-full" style={{ height: "auto" }}>
        <text x={PAD.left - 4} y={PAD.top + 3} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{axisMax}h</text>
        <text x={PAD.left - 4} y={bottomY} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">0</text>

        {nights.map((n, i) => (
          <g key={n.date}>
            <title>{`${formatDayKeyShort(n.date)} — Garmin left, Eight Sleep right`}</title>
            {bar("g", centre(i) - gap / 2 - barW, n.garmin, false)}
            {bar("e", centre(i) + gap / 2, n.eight, true)}
          </g>
        ))}

        <path d={buildLinePath(gPts)} fill="none" stroke="rgb(var(--warn))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d={buildLinePath(ePts)} fill="none" stroke="rgb(var(--warn))" strokeWidth="1.5" strokeDasharray="4 3" strokeLinecap="round" strokeLinejoin="round" />
        {gPts.map((pt, i) => (pt ? <circle key={`g${i}`} cx={pt.x.toFixed(1)} cy={pt.y.toFixed(1)} r="2" fill="rgb(var(--warn))" /> : null))}
        {ePts.map((pt, i) => (pt ? <circle key={`e${i}`} cx={pt.x.toFixed(1)} cy={pt.y.toFixed(1)} r="2" fill="none" stroke="rgb(var(--warn))" strokeWidth="1.2" /> : null))}

        <line x1={PAD.left} y1={bottomY} x2={WIDTH - PAD.right} y2={bottomY} stroke="rgb(var(--muted))" strokeWidth="0.5" strokeOpacity="0.4" />
        <text x={PAD.left} y={HEIGHT - 8} fontSize="9" fill="rgb(var(--muted))">{formatDayKeyShort(nights[0].date)}</text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 8} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{formatDayKeyShort(nights[nights.length - 1].date)}</text>
      </svg>

      <Legend
        items={[
          ...STAGES.map((s) => ({ label: s.label, color: s.color, opacity: s.opacity })),
          { label: "Garmin score", color: "rgb(var(--warn))", line: true },
          { label: "Eight Sleep score", color: "rgb(var(--warn))", line: true, dash: true },
        ]}
      />
      <p className="mt-1 text-[11px] text-muted">
        Each night: Garmin bar on the left, Eight Sleep bar (outlined) on the right.
        {appleNights > 0 && ` The left bar comes from Apple Health on ${appleNights} ${appleNights === 1 ? "night" : "nights"}.`}
      </p>
    </ChartCard>
  );
}
