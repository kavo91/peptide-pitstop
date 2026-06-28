/**
 * Dashboard Wellness tile. Presentational only.
 *
 * Two modes, decided by `snapshot`:
 *   • WEARABLE — when a Garmin snapshot has any recovery signal (Body Battery,
 *     sleep score, HRV or resting HR), show a compact recovery snapshot.
 *   • MANUAL (fallback) — otherwise render the existing 7-day journal trend
 *     (latest weight, 7-day delta, sparkline, mood/energy). Unchanged behaviour.
 * With no data of either kind it degrades to a CTA linking to /journal.
 */
import Link from "next/link";
import type { WellnessTrend } from "@/lib/wellness";
import type { WearableSnapshot } from "@/lib/wearable-series";
import { activityDisplay, fmtActivityDuration } from "@/lib/garmin-activity";
import { GaugeRing } from "../GaugeRing";

const SPARK_W = 120;
const SPARK_H = 32;
const SPARK_PAD = 3;

/** Tiny weight sparkline — same inline-SVG approach as PlasmaChart. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (SPARK_W - 2 * SPARK_PAD) / (values.length - 1);
  const path = values
    .map((v, i) => {
      const x = SPARK_PAD + i * stepX;
      const y = SPARK_PAD + (1 - (v - min) / range) * (SPARK_H - 2 * SPARK_PAD);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} className="h-8 w-full" aria-hidden="true">
      <path d={path} fill="none" stroke="rgb(var(--accent))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** True when the snapshot carries any wearable recovery signal. */
function hasWearableRecovery(s: WearableSnapshot | null | undefined): s is WearableSnapshot {
  return (
    !!s &&
    (s.bodyBattery != null || s.sleepScore != null || s.hrvMs != null || s.restingHr != null)
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Today" / "Yesterday" / "D Mon" for the snapshot's as-of day, vs the local
 * (server-TZ) today. Anything older than today is `stale` so the card can flag
 * it — otherwise a sync gap silently shows yesterday's recovery as if current.
 */
function asOfLabel(asOf: string): { text: string; stale: boolean } {
  const dk = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const now = new Date();
  if (asOf === dk(now)) return { text: "Today", stale: false };
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (asOf === dk(y)) return { text: "Yesterday", stale: true };
  const [, m, d] = asOf.split("-").map(Number);
  return { text: `${d ?? ""} ${MONTHS[(m ?? 1) - 1] ?? ""}`.trim(), stale: true };
}

/**
 * Apex-Line radial gauge ring (pitstop only). The coloured arc length is
 * proportional to `value` within [min,max]; `invert` flips it so a lower value
 * reads as a fuller arc (used for RHR, where lower is better). Geometry is
 * faithful to concept-pitstop-apexline.html: an r=18 ring in a 46×46 box, 4px
 * stroke, arc swept clockwise from 12 o'clock. The value sits in the centre in
 * bold IBM Plex Mono (via `tabular-nums`, which the pitstop design maps to the
 * mono face) tinted with the arc colour, with a small uppercase label below.
 */
/** Compact Garmin recovery snapshot — used when wearable data is present. */
function RecoverySnapshot({ snapshot, design }: { snapshot: WearableSnapshot; design: "pitstop" | "current" }) {
  // Pitstop — Apex-Line radial gauges. Body Battery / Sleep / HRV / RHR each
  // render as an arc ring (race-orange primary + green/cyan accents) with the
  // value in the centre; Exercise stays a text line. The "Recovery · Garmin ·
  // <as-of>" header + staleness label logic are kept intact.
  if (design === "pitstop") {
    const a = asOfLabel(snapshot.asOf);
    const gauges = [
      snapshot.bodyBattery != null && (
        <GaugeRing key="bb" label="Body Bat" value={snapshot.bodyBattery} display={snapshot.bodyBattery} min={0} max={100} color="rgb(var(--accent))" />
      ),
      snapshot.sleepScore != null && (
        <GaugeRing key="sleep" label="Sleep" value={snapshot.sleepScore} display={snapshot.sleepScore} min={0} max={100} color="rgb(var(--accent-2-strong))" />
      ),
      snapshot.hrvMs != null && (
        <GaugeRing key="hrv" label="HRV" value={snapshot.hrvMs} display={snapshot.hrvMs} unit="ms" min={20} max={100} color="rgb(var(--ok))" />
      ),
      snapshot.restingHr != null && (
        <GaugeRing key="rhr" label="RHR" value={snapshot.restingHr} display={snapshot.restingHr} unit="bpm" min={40} max={90} color="rgb(var(--ok))" invert />
      ),
    ].filter(Boolean);

    return (
      <Link href="/journal" className="flex h-full flex-col gap-3 rounded-card bg-surface p-4 ring-1 ring-line/10 shadow-sm">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-medium text-muted">Recovery</p>
          <span className="text-[10px] font-medium text-muted">
            Garmin · <span className={a.stale ? "text-warn" : "text-ink"}>{a.text}</span>
          </span>
        </div>

        <div className="grid grid-cols-4 gap-2">{gauges}</div>

        {snapshot.activities.length > 0 && (() => {
          const act = snapshot.activities[0];
          const disp = activityDisplay(act.type);
          const Icon = disp.icon;
          const more = snapshot.activities.length - 1;
          // The workout's OWN day — labelled only when it isn't today, so a ride
          // logged yesterday reads "· Yesterday" instead of as today's exercise.
          const actDay = snapshot.activitiesAsOf ? asOfLabel(snapshot.activitiesAsOf) : null;
          return (
            <span className="mt-auto inline-flex items-center gap-1 text-xs text-muted">
              Exercise
              <Icon className={`h-3.5 w-3.5 ${disp.colorClass}`} aria-hidden />
              <span className="font-medium text-ink">{disp.label} {fmtActivityDuration(act.durationSec)}{more > 0 ? ` +${more}` : ""}</span>
              {actDay?.stale && <span className="text-warn">· {actDay.text}</span>}
            </span>
          );
        })()}
      </Link>
    );
  }

  // Lead with Body Battery; fall back to sleep score as the headline metric.
  const headline =
    snapshot.bodyBattery != null
      ? { value: snapshot.bodyBattery, label: "Body Battery" }
      : snapshot.sleepScore != null
        ? { value: snapshot.sleepScore, label: "Sleep score" }
        : null;

  return (
    <Link href="/journal" className="flex h-full flex-col gap-2 rounded-card bg-surface p-4 ring-1 ring-line/10 shadow-sm">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium text-muted">Recovery</p>
        {(() => {
          const a = asOfLabel(snapshot.asOf);
          return (
            <span className="text-[10px] font-medium text-muted">
              Garmin · <span className={a.stale ? "text-warn" : "text-ink"}>{a.text}</span>
            </span>
          );
        })()}
      </div>

      {headline ? (
        <p className="font-mono text-2xl font-semibold tabular-nums text-ink">
          {headline.value}
          <span className="ml-1 text-xs font-normal text-muted">{headline.label}</span>
        </p>
      ) : (
        <p className="text-sm text-muted">Recovery synced</p>
      )}

      <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {snapshot.activities.length > 0 && (() => {
          const a = snapshot.activities[0];
          const disp = activityDisplay(a.type);
          const Icon = disp.icon;
          const more = snapshot.activities.length - 1;
          // The workout's OWN day — labelled only when it isn't today.
          const actDay = snapshot.activitiesAsOf ? asOfLabel(snapshot.activitiesAsOf) : null;
          return (
            <span className="inline-flex items-center gap-1">
              Exercise
              <Icon className={`h-3.5 w-3.5 ${disp.colorClass}`} aria-hidden />
              <span className="font-medium text-ink">{disp.label} {fmtActivityDuration(a.durationSec)}{more > 0 ? ` +${more}` : ""}</span>
              {actDay?.stale && <span className="text-warn">· {actDay.text}</span>}
            </span>
          );
        })()}
        {snapshot.bodyBattery != null && snapshot.sleepScore != null && (
          <span>Sleep <span className="font-medium text-ink">{snapshot.sleepScore}</span></span>
        )}
        {snapshot.hrvMs != null && (
          <span>HRV <span className="font-medium tabular-nums text-ink">{snapshot.hrvMs} ms</span></span>
        )}
        {snapshot.restingHr != null && (
          <span>RHR <span className="font-medium tabular-nums text-ink">{snapshot.restingHr} bpm</span></span>
        )}
      </div>
    </Link>
  );
}

export function WellnessTile({
  trend,
  snapshot,
  design = "current",
}: {
  trend: WellnessTrend;
  snapshot?: WearableSnapshot | null;
  /** Active design pack (from page.tsx via activeDesign()). Only the pitstop
   *  recovery snapshot diverges; every other branch is design-agnostic. */
  design?: "pitstop" | "current";
}) {
  // Wearable recovery takes precedence over the manual journal trend.
  if (hasWearableRecovery(snapshot)) {
    return <RecoverySnapshot snapshot={snapshot} design={design} />;
  }

  if (!trend.hasData) {
    return (
      <a
        href="/journal"
        className="flex h-full flex-col items-center justify-center gap-2 rounded-card bg-surface p-4 text-center ring-1 ring-line/10 shadow-sm"
      >
        <p className="text-xs font-medium text-muted">Wellness</p>
        <p className="text-sm text-muted">Start logging wellness to see your 7-day trend</p>
        <span className="mt-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accentStrong">Log now →</span>
      </a>
    );
  }

  const weights = trend.points.map((p) => p.weight).filter((w): w is number => w != null);
  const delta = trend.weightDelta;
  const deltaStr = delta == null ? null : `${delta > 0 ? "+" : ""}${delta}${trend.weightUnit ? ` ${trend.weightUnit}` : ""}`;
  const deltaTone = delta == null || delta === 0 ? "text-muted" : "text-ink";

  return (
    <Link href="/journal" className="flex h-full flex-col gap-2 rounded-card bg-surface p-4 ring-1 ring-line/10 shadow-sm">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium text-muted">Wellness</p>
        {deltaStr && (
          <span className={`text-xs font-medium tabular-nums ${deltaTone}`}>
            {deltaStr} <span className="text-muted">7d</span>
          </span>
        )}
      </div>

      {trend.latestWeight != null ? (
        <p className="font-mono text-2xl font-semibold tabular-nums text-ink">
          {trend.latestWeight}
          {trend.weightUnit && <span className="ml-1 text-xs font-normal text-muted">{trend.weightUnit}</span>}
        </p>
      ) : (
        <p className="text-sm text-muted">No weight logged</p>
      )}

      {weights.length >= 2 && <Sparkline values={weights} />}

      <div className="mt-auto flex gap-4 text-xs text-muted">
        {trend.latestMood != null && (
          <span>Mood <span className="font-medium text-ink">{trend.latestMood}/5</span></span>
        )}
        {trend.latestEnergy != null && (
          <span>Energy <span className="font-medium text-ink">{trend.latestEnergy}/5</span></span>
        )}
      </div>
    </Link>
  );
}
