/**
 * Wellness / Journal — log weight, mood, energy, sleep, side effects and notes,
 * and review recent entries. Encrypted free-text (side effects, notes) is
 * decrypted at read time; never queried on.
 */
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { decryptField } from "@/lib/crypto/fieldEncryption";
import { formatSideEffects, deserializeSideEffects, resolveSymptomList } from "@/lib/side-effects";
import { mergeWellnessLog, type ManualDay } from "@/lib/wellness-log";
import { getWearableWindow } from "@/lib/wearable";
import { startOfDay } from "@/lib/schedule/schedule";
import { BackButton } from "@/components/BackButton";
import { WearableSection } from "@/components/wellness/WearableSection";
import { TodayCard } from "@/components/wellness/TodayCard";
import { PitstopHeading } from "@/components/PitstopHeading";
import Link from "next/link";
import { PAGE_MAIN } from "@/lib/layout";

export const dynamic = "force-dynamic";

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v.toString());
  return Number.isFinite(n) ? n : null;
}

// Local "YYYY-MM-DD" day key — same convention buildWearableSeries uses, so the
// manual entries and the Garmin series line up on the same calendar day.
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function JournalPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <PitstopHeading title="Wellness" index={7} className="text-3xl font-semibold tracking-tight" split={["WELL", "NESS"]} />
        <p className="mt-4 text-muted">Sign in to track your wellness.</p>
      </main>
    );
  }

  // 7-day wearable window — the journal charts are summary-only; deeper ranges
  // live in the per-chart detail view. Rows are stored at local-midnight.
  const wearTo = new Date();
  const wearFrom = startOfDay(new Date());
  wearFrom.setDate(wearFrom.getDate() - 7);

  const [entries, wearable] = await Promise.all([
    prisma.journalEntry.findMany({
      where: { userId: user.id },
      orderBy: { date: "desc" },
      take: 30,
    }),
    getWearableWindow(user.id, wearFrom, wearTo),
  ]);

  // Decrypt free-text here (the merge helper stays pure), then merge the manual
  // log with the Garmin series into one unified per-day record.
  const manualDays: ManualDay[] = entries.map((e) => {
    const decryptedSideEffects = decryptField(e.sideEffects);
    return {
      date: dayKey(e.date),
      id: e.id,
      weight: toNum(e.weight),
      weightUnit: e.weightUnit ?? null,
      mood: e.mood ?? null,
      energy: e.energy ?? null,
      sleep: toNum(e.sleep),
      calories: e.calories ?? null,
      proteinG: toNum(e.proteinG),
      waterMl: e.waterMl ?? null,
      sideEffects: formatSideEffects(decryptedSideEffects) || null,
      sideEffectEntries: deserializeSideEffects(decryptedSideEffects),
      notes: decryptField(e.notes) || null,
    };
  });
  const logDays = mergeWellnessLog(manualDays, wearable);

  // Daily log shows today only — browse/edit past days in the month schedule.
  const todayKey = dayKey(new Date());
  const todayLog = logDays.filter((d) => d.date === todayKey);

  return (
    <main className={PAGE_MAIN}>
      {/* At ≥1900px the readable text column (left, capped) and the Wearable
          charts (right, fills remaining width) sit side-by-side instead of the
          charts tailing full-width below — that removes the single-column tail and
          shortens the page at ultrawide. The side-by-side is gated to ≥1900px (not
          the 1440px dead-zone, where the 1152px container is too narrow to split
          without cramming the charts). Below 1900px this wrapper is a plain block
          so the text column and WearableSection stack exactly as before. */}
      <div className="min-[1900px]:flex min-[1900px]:items-start min-[1900px]:gap-8">
      {/* Header + Today/log block stay a readable column on ultra-wide (the wider
          main is for the charts). The cap is a no-op below 1440px. */}
      <div className="min-[1900px]:max-w-3xl min-[1900px]:shrink-0">
        <BackButton fallback="/more" />
        <div className="mb-6">
          <PitstopHeading title="Wellness" index={7} className="text-3xl font-semibold tracking-tight" split={["WELL", "NESS"]} />
          <p className="text-muted">Weight, mood, energy, sleep and side effects.</p>
        </div>

        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-medium">Today</h2>
          <Link href="/doses?view=month" className="text-sm font-medium text-accentStrong hover:underline">
            Month schedule →
          </Link>
        </div>

        <TodayCard
          today={todayLog[0]}
          todayKey={todayKey}
          hydrationTargetMl={user.hydrationTargetMl ?? null}
          symptoms={resolveSymptomList(user.symptomList)}
        />
      </div>

        {/* Right column at ≥1900px. min-w-0 lets the SVG charts shrink to fit
            (avoids horizontal overflow); -mt-10 cancels WearableSection's own
            mt-10 so it top-aligns with the text column. Below 1900px it's a plain
            block and WearableSection keeps its mt-10 gap below the text column. */}
        <div className="min-[1900px]:min-w-0 min-[1900px]:flex-1 min-[1900px]:-mt-10">
          <WearableSection series={wearable} />
        </div>
      </div>
    </main>
  );
}
