import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/owner";
import { getWeek, getMonth, weekStartOf } from "@/lib/doses-timeline";
import { DosesWeek } from "@/components/DosesWeek";
import { DosesMonth } from "@/components/DosesMonth";
import { BackButton } from "@/components/BackButton";
import { prisma } from "@/lib/db";
import { decryptField } from "@/lib/crypto/fieldEncryption";
import { formatSideEffects, deserializeSideEffects, resolveSymptomList } from "@/lib/side-effects";
import { parseMonthParam, shiftMonth, monthKey } from "@/lib/month-nav";
import { parseWeekParam, shiftWeek, weekKey } from "@/lib/week-nav";
import type { ManualDay } from "@/lib/wellness-log";
import { activeDesign } from "@/lib/design";
import { PitstopHeading } from "@/components/PitstopHeading";
import { PAGE_MAIN } from "@/lib/layout";

export const dynamic = "force-dynamic";

function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

/** Relative-day label for the "Next on the line" card: TODAY / TMR / "WED 25 JUN". */
function relDayLabel(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return "TODAY";
  const a = new Date(todayKey + "T00:00:00");
  const b = new Date(dateKey + "T00:00:00");
  const diffDays = Math.round((b.getTime() - a.getTime()) / 86400000);
  if (diffDays === 1) return "TMR";
  return b.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" }).toUpperCase();
}

/** Load the month's manual wellness entries, keyed by local day, for prefilling
 *  the per-day edit modal. Mirrors the journal page's decrypt/map. */
async function loadWellnessByDay(userId: string, gridStart: string, gridEnd: string): Promise<Record<string, ManualDay>> {
  const from = new Date(gridStart + "T00:00:00");
  const to = new Date(gridEnd + "T23:59:59");
  const rows = await prisma.journalEntry.findMany({ where: { userId, date: { gte: from, lte: to } } });
  const map: Record<string, ManualDay> = {};
  for (const e of rows) {
    const key = ymd(e.date);
    const decryptedSideEffects = decryptField(e.sideEffects);
    map[key] = {
      date: key,
      id: e.id,
      weight: e.weight == null ? null : Number(e.weight.toString()),
      weightUnit: e.weightUnit ?? null,
      mood: e.mood ?? null,
      energy: e.energy ?? null,
      sleep: e.sleep == null ? null : Number(e.sleep.toString()),
      calories: e.calories ?? null,
      proteinG: e.proteinG == null ? null : Number(e.proteinG.toString()),
      waterMl: e.waterMl ?? null,
      sideEffects: formatSideEffects(decryptedSideEffects) || null,
      sideEffectEntries: deserializeSideEffects(decryptedSideEffects),
      notes: decryptField(e.notes) || null,
    };
  }
  return map;
}

export default async function DosesPage({ searchParams }: { searchParams: { view?: string; month?: string; weekStart?: string } }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const view = searchParams.view === "month" ? "month" : "week";
  const design = activeDesign();
  const today = new Date();
  const todayKey = ymd(today);

  // Current design: full-width pill (byte-identical). Pitstop: compact inline
  // segmented control with a skewed active option. Navigation + a11y preserved.
  const tab = (v: string, label: string) => {
    if (design === "pitstop") {
      const active = view === v;
      return (
        <a
          href={`/doses?view=${v}`}
          aria-current={active ? "page" : undefined}
          className={`px-3 py-1.5 rounded-md text-[11px] uppercase tracking-[0.08em] ${active ? "bg-accent text-onAccent" : "text-muted hover:bg-bg"}`}
          style={active ? { transform: "skewX(-7deg)" } : undefined}
        >
          {active ? <span style={{ display: "inline-block", transform: "skewX(7deg)" }}>{label}</span> : label}
        </a>
      );
    }
    return (
      <Link href={`/doses?view=${v}`} className={`flex-1 rounded-control px-3 py-2 text-center text-sm font-medium ${view === v ? "bg-accent text-onAccent" : "bg-bg text-muted ring-1 ring-line/15"}`}>{label}</Link>
    );
  };

  let body: React.ReactNode;
  if (view === "week") {
    const anchor = parseWeekParam(searchParams.weekStart, today);
    const w = await getWeek(user.id, anchor);
    const nav = {
      prev: weekKey(shiftWeek(anchor, -1)),
      next: weekKey(shiftWeek(anchor, 1)),
      current: weekKey(weekStartOf(today)),
      isCurrent: weekKey(anchor) === weekKey(weekStartOf(today)),
    };
    body = <DosesWeek days={w.days} entries={w.entries} todayKey={todayKey} nav={nav} />;
  } else {
    const anchor = parseMonthParam(searchParams.month, today);
    const m = await getMonth(user.id, anchor);
    const wellnessByDay = await loadWellnessByDay(user.id, m.gridStart, m.gridEnd);
    const nav = {
      prev: monthKey(shiftMonth(anchor, -1)),
      next: monthKey(shiftMonth(anchor, 1)),
      current: monthKey(today),
      isCurrent: monthKey(anchor) === monthKey(today),
    };
    // Earliest upcoming planned dose on/after today (within the visible grid).
    const upcoming = m.entries
      .filter((e) => e.status === "planned" && e.date >= todayKey)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time ?? "").localeCompare(b.time ?? "")));
    const next = upcoming[0];
    const nextDose = next
      ? {
          peptideName: next.peptideName,
          doseLabel: next.doseLabel,
          time: next.time ?? null,
          relDay: relDayLabel(next.date, todayKey),
        }
      : undefined;
    body = <DosesMonth monthLabel={m.monthLabel} gridStart={m.gridStart} gridEnd={m.gridEnd} entries={m.entries} metrics={m.metrics} todayKey={todayKey} wellnessByDay={wellnessByDay} hydrationTargetMl={user.hydrationTargetMl ?? null} symptoms={resolveSymptomList(user.symptomList)} nav={nav} design={design} nextDose={nextDose} />;
  }

  return (
    <main className={PAGE_MAIN}>
      <BackButton fallback="/" />
      <PitstopHeading title="Doses" index={2} design={design} className="mb-1 text-3xl font-semibold tracking-tight" split={["DO", "SES"]} />
      <p className="mb-4 text-muted">Your schedule — past and upcoming.</p>
      {design === "pitstop" ? (
        <div className="mb-5 inline-flex rounded-lg bg-surface p-0.5 ring-1 ring-line/15">{tab("week", "This week")}{tab("month", "Month")}</div>
      ) : (
        <div className="mb-5 flex gap-2">{tab("week", "This week")}{tab("month", "Month")}</div>
      )}
      {body}
    </main>
  );
}
