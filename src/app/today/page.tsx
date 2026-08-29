/**
 * Today — the full actionable dose list for a given day (day-nav inside
 * TodaysDosesCard). Reached from the Dashboard's Today summary tile. Kept off
 * the Dashboard so that page stays a scannable command center.
 */
import { getCurrentUser } from "@/lib/auth/owner";
import { prisma } from "@/lib/db";
import { viewerToday } from "@/lib/viewer-tz";
import { getTodayDoses, getLoggedToday } from "@/lib/today";
import { getStacks } from "@/lib/stacks/server";
import { BackButton } from "@/components/BackButton";
import { TodaysDosesCard } from "@/components/dashboard/TodaysDosesCard";
import { StackCard } from "@/components/StackCard";
import { PAGE_MAIN } from "@/lib/layout";
import { CycleBanner } from "@/components/CycleBanner";
import { getCycleBannerItems } from "@/lib/cycle/server";

export const dynamic = "force-dynamic";

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <p className="text-muted">Not signed in.</p>
      </main>
    );
  }
  const query = await searchParams;

  // "Today" is the VIEWER's calendar day (device timezone via the pt_tz
  // cookie), not the container's — while travelling west of home the two
  // differ for part of the day and the server-clock version showed tomorrow.
  const viewer = await viewerToday();
  const todayKey = viewer.key;
  const viewDate =
    query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date)
      ? new Date(query.date + "T12:00:00")
      : viewer.date;
  const viewKey = ymd(viewDate);
  const isToday = viewKey === todayKey;

  const [due, logged, cycleItems] = await Promise.all([
    getTodayDoses(user.id, viewDate, isToday ? new Date() : viewDate),
    getLoggedToday(user.id, viewDate),
    // Cycle prompts are about TODAY's decision, so they only show on the real
    // today view — browsing back to last Tuesday must not offer "stop dosing".
    isToday ? getCycleBannerItems(user.id, viewDate) : Promise.resolve([]),
  ]);

  // Stacks are surfaced (with one-tap "Log stack") only on the actual today
  // view, AND only while at least one component still has an UNLOGGED dose due
  // today. Reuse the `due` authority (getTodayDoses: start/end window + schedule
  // + overrides) and exclude already-logged components, so a stack whose doses
  // don't fall on today — or are all already logged — drops off for the day.
  const dueProtocolIds = new Set(due.filter((d) => !d.alreadyLoggedToday).map((d) => d.protocolId));
  const stacks = isToday
    ? (await getStacks(user.id)).filter((s) => s.components.some((c) => dueProtocolIds.has(c.protocolId)))
    : [];

  // Recent injection sites per peptide → BodyMap recency colouring in LogDoseForm.
  const recentSitesByPeptide = new Map<string, string[]>();
  await Promise.all(
    due.map(async (d) => {
      const logs = await prisma.doseLog.findMany({
        where: {
          userId: user.id,
          preparation: { vial: { peptideId: d.peptideId } },
          injectionSite: { not: null },
        },
        orderBy: { takenAt: "desc" },
        take: 10,
        select: { injectionSite: true },
      });
      recentSitesByPeptide.set(d.peptideId, logs.map((l) => l.injectionSite!));
    }),
  );

  const syringes = (
    await prisma.syringe.findMany({
      where: { OR: [{ userId: user.id }, { userId: null }] },
      orderBy: { name: "asc" },
    })
  ).map((s) => ({
    id: s.id,
    name: s.name,
    graduationType: s.graduationType as "units" | "ml",
    deviceType: (s.deviceType === "pen" ? "pen" : "syringe") as "syringe" | "pen",
    unitsPerMl: s.unitsPerMl,
    capacityMl: s.capacityMl.toString(),
    capacityUnits: s.capacityUnits,
    increment: s.increment.toString(),
  }));

  return (
    <main className={PAGE_MAIN}>
      <BackButton fallback="/" />
      <h1 className="sr-only">Today</h1>
      <CycleBanner alerts={cycleItems} />
      {stacks.length > 0 ? (
        // Desktop (≥1440px): stacks rail BESIDE the dose list (left rail ~320px,
        // right card). Mobile / smaller laptops: single column, stacks above the
        // card. The two-up grid only activates here — i.e. when unlogged stacks
        // exist — so the second column is never empty.
        <div className="min-[1440px]:grid min-[1440px]:grid-cols-[320px_minmax(0,1fr)] min-[1440px]:items-start min-[1440px]:gap-8">
          <section className="mb-4 space-y-2 min-[1440px]:mb-0">
            <h2 className="text-sm font-medium text-muted">Stacks</h2>
            {stacks.map((s) => (
              <StackCard key={s.id} stack={s} />
            ))}
          </section>
          <TodaysDosesCard
            due={due}
            logged={logged}
            syringes={syringes}
            recentSitesByPeptide={recentSitesByPeptide}
            viewDate={viewDate}
            viewKey={viewKey}
            isToday={isToday}
          />
        </div>
      ) : (
        <TodaysDosesCard
          due={due}
          logged={logged}
          syringes={syringes}
          recentSitesByPeptide={recentSitesByPeptide}
          viewDate={viewDate}
          viewKey={viewKey}
          isToday={isToday}
        />
      )}
    </main>
  );
}
