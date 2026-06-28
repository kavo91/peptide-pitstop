/**
 * Unified per-day wellness log. Presentational server component: takes the
 * merged WellnessLogDay[] (manual entry + that day's Garmin data, joined by date)
 * and renders one reverse-chron card per day. Each card shows a "Logged" manual
 * sub-block (only when the user logged that day) and a "Garmin" sub-block (only
 * when wearable data synced that day), each clearly sourced. CSS-var tokens only;
 * mobile grid that widens at lg — mirrors the journal entry cards it replaces.
 */
import { activityDisplay, fmtActivityDistance, fmtActivityDuration } from "@/lib/garmin-activity";
import type { WellnessLogDay, ManualDay, WellnessLogGarmin } from "@/lib/wellness-log";
import { DeleteJournalButton } from "@/components/DeleteJournalButton";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Format a "YYYY-MM-DD" key to "D Mon YYYY". Parses the string parts (not
 * `new Date(key)`) so SSR and client render identically — no hydration drift.
 */
export function fmtDayKey(key: string): string {
  const [y, m, d] = key.split("-").map((p) => Number(p));
  return `${d ?? ""} ${MONTHS[(m ?? 1) - 1] ?? ""} ${y ?? ""}`.trim();
}

/** Seconds → "7h 12m" (rounded to the nearest minute). */
function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function Tag({ label, tone }: { label: string; tone: "manual" | "garmin" }) {
  const cls =
    tone === "garmin"
      ? "bg-accent2/10 text-accent2Strong"
      : "bg-accent/10 text-accentStrong";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function ManualBlock({ m }: { m: ManualDay }) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2">
        <Tag label="Logged" tone="manual" />
        {m.id && <DeleteJournalButton id={m.id} label={`${fmtDayKey(m.date)} entry`} />}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {m.weight != null && <Metric label="Weight" value={`${m.weight} ${m.weightUnit ?? ""}`.trim()} />}
        {m.mood != null && <Metric label="Mood" value={`${m.mood}/5`} />}
        {m.energy != null && <Metric label="Energy" value={`${m.energy}/5`} />}
        {m.sleep != null && <Metric label="Sleep" value={`${m.sleep} h`} />}
      </dl>
      {m.sideEffects && (
        <div className="mt-3">
          <dt className="text-xs text-muted">Side effects</dt>
          <dd className="text-sm">{m.sideEffects}</dd>
        </div>
      )}
      {m.notes && (
        <div className="mt-2">
          <dt className="text-xs text-muted">Notes</dt>
          <dd className="text-sm">{m.notes}</dd>
        </div>
      )}
    </div>
  );
}

export function GarminBlock({ g }: { g: WellnessLogGarmin }) {
  const sleep =
    g.sleepSeconds != null || g.sleepScore != null
      ? [g.sleepSeconds != null ? fmtDuration(g.sleepSeconds) : null, g.sleepScore != null ? `score ${g.sleepScore}` : null]
          .filter(Boolean)
          .join(" · ")
      : null;

  return (
    <div className="mt-3 border-t border-line/10 pt-3">
      <Tag label="Garmin" tone="garmin" />
      <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {sleep && <Metric label="Sleep" value={sleep} />}
        {g.weightKg != null && <Metric label="Weight" value={`${g.weightKg} kg`} />}
        {g.steps != null && <Metric label="Steps" value={g.steps.toLocaleString()} />}
        {g.caloriesActive != null && <Metric label="Active cal" value={`${g.caloriesActive}`} />}
        {g.intensityMinutes != null && <Metric label="Intensity" value={`${g.intensityMinutes} min`} />}
        {g.restingHr != null && <Metric label="Resting HR" value={`${g.restingHr} bpm`} />}
        {g.hrvMs != null && <Metric label="HRV" value={`${g.hrvMs} ms`} />}
        {g.bodyBattery != null && <Metric label="Body Battery" value={`${g.bodyBattery}`} />}
      </dl>
      {g.activities.length > 0 && (
        <div className="mt-3">
          <dt className="text-xs text-muted">Activities</dt>
          <ul className="mt-1 space-y-1.5">
            {g.activities.map((a, i) => {
              const disp = activityDisplay(a.type);
              const Icon = disp.icon;
              const detail = [fmtActivityDuration(a.durationSec), a.distanceM != null ? fmtActivityDistance(a.distanceM) : null]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <Icon className={`h-4 w-4 shrink-0 ${disp.colorClass}`} aria-hidden />
                  <span className="font-medium">{a.name || disp.label}</span>
                  <span className="text-muted tabular-nums">{detail}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export function WellnessLog({ days }: { days: WellnessLogDay[] }) {
  if (days.length === 0) {
    return <p className="text-muted">No entries yet — log your first above, or sync Garmin.</p>;
  }

  return (
    <ul className="grid gap-3">
      {days.map((day) => (
        <li key={day.date} className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
          <p className="font-medium tabular-nums">{fmtDayKey(day.date)}</p>
          {day.manual && <ManualBlock m={day.manual} />}
          {day.garmin && <GarminBlock g={day.garmin} />}
        </li>
      ))}
    </ul>
  );
}
