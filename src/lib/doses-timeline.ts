import "server-only";
import { prisma } from "@/lib/db";
import { startOfDay, addDays } from "@/lib/schedule/schedule";
import { timeInTz } from "@/lib/tz-day";
import { resolveTitration } from "@/lib/titration/resolve";
import { buildResolveInput } from "@/lib/titration/from-protocol";
import { supersededFrom, type LoggedDose, type TimelineEntry } from "./doses-timeline-core";
import { buildTimelineEntries, clipSlotsToRange, type ResolvedOcc } from "./timeline-status";
import { monthMetricsByDay } from "./month-metrics";

const KEY = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Monday (local) of the week containing `date` — calendars are Monday-first. */
export function weekStartOf(date: Date): Date {
  const s = startOfDay(date);
  return addDays(s, -((s.getDay() + 6) % 7));
}

async function buildResolvedOccurrences(userId: string, rangeStart: Date, rangeEnd: Date): Promise<ResolvedOcc[]> {
  const protocols = await prisma.protocol.findMany({
    where: {
      userId,
      OR: [
        { status: "active" },
        {
          status: "completed",
          OR: [{ endDate: null }, { endDate: { gte: startOfDay(rangeStart) } }],
          AND: [{ OR: [{ startDate: null }, { startDate: { lte: startOfDay(rangeEnd) } }] }],
        },
      ],
    },
    include: { peptide: true, stack: true, steps: true },
  });
  const now = new Date();
  // A retired course stops where its replacement begins — otherwise an
  // early-closed protocol keeps emitting slots (bounded only by an endDate weeks
  // out) that no log can match, and they render as misses on days the user did
  // dose, beside the live protocol's own slots.
  const supersededAt = supersededFrom(protocols);

  const out: ResolvedOcc[] = [];
  for (const p of protocols) {
    if (!p.scheduleRule) continue;

    // The resolver's phase cursor + ±adherence matcher needs this protocol's FULL
    // delivered history (not just in-range), so titration phases and the
    // taken/off-schedule split match Today exactly (same matcher, same FCFS).
    const deliveredLogs = await prisma.doseLog.findMany({
      where: { userId, protocolId: p.id },
      select: { id: true, takenAt: true, localDay: true },
    });

    // Resolve over an EXPANDED range (rangeEnd + 31d) so the trailing in-range
    // slot has a real successor for slotStatus's missed/pending decision —
    // otherwise the last slot of a past view-range gets nextStart=null and shows
    // "planned" instead of "missed". 31 days guarantees a successor for any
    // ≤monthly cadence. The buffer slots are clipped off below before display.
    const resolved = resolveTitration(
      buildResolveInput({
        protocol: p,
        deliveredLogs,
        range: { start: rangeStart, end: addDays(startOfDay(rangeEnd), 31) },
        now,
      }),
    );

    // Map each ResolvedSlot → a per-slot timeline entry. The per-injection dose
    // comes ONLY from the resolver (already basis-divided + phase-resolved); a
    // raw per_week weekly value must never reach the label (spec §6) — an empty
    // perInjectionValue yields "" and the consumer simply shows no dose.
    // doseLogId comes from the resolver's own match (matchedLogId, Task B0); we
    // do NOT re-match here, so the timeline's taken/off-schedule split is
    // identical to Today's.
    const cutoff = supersededAt.get(p.id);
    const mapped = resolved.slots
      .filter((s) => !cutoff || KEY(s.date) < cutoff)
      .map((s) => ({
        date: KEY(s.date),
        time: s.time,
        status: s.status,
        doseLabel: s.perInjectionValue ? `${s.perInjectionValue} ${s.perInjectionUnit}` : "",
        phaseIndex: s.phaseIndex,
        doseLogId: s.matchedLogId ?? undefined,
        rebased: s.rebased,
      }));
    out.push({
      protocolId: p.id,
      peptideId: p.peptideId,
      peptideName: p.peptide.name,
      stackId: p.stackId,
      stackName: p.stack?.name ?? null,
      // Clip the expanded-range buffer back to the viewed window.
      slots: clipSlotsToRange(mapped, KEY(startOfDay(rangeStart)), KEY(startOfDay(rangeEnd))),
    });
  }
  return out;
}

async function buildLogs(userId: string, rangeStart: Date, rangeEnd: Date): Promise<LoggedDose[]> {
  const logs = await prisma.doseLog.findMany({
    // ±1 day beyond the requested range: a dose with a client-stamped localDay
    // can sit up to a day away from its takenAt instant (taken Friday night in
    // a UTC-4 zone = Saturday in the runtime TZ), so instant-window fetching
    // alone would drop it at a range edge. Out-of-range dateKeys simply don't
    // match any grid day downstream.
    where: { userId, takenAt: { gte: addDays(startOfDay(rangeStart), -1), lt: addDays(startOfDay(rangeEnd), 2) } },
    include: {
      preparation: { include: { vial: { include: { peptide: true } } } },
      // Oral doses have no preparation — resolve the peptide via the protocol.
      protocol: { include: { peptide: true, stack: true } },
    },
  });
  return logs.map((l) => {
    const t = new Date(l.takenAt);
    return {
      protocolId: l.protocolId,
      // Injection: prep→vial→peptide. Oral (no prep): the linked protocol's peptide,
      // else "" (an unlinked ad-hoc oral dose still appears, with no peptide grouping).
      peptideId: l.preparation?.vial.peptideId ?? l.protocol?.peptideId ?? "",
      peptideName: l.preparation?.vial.peptide.name ?? l.protocol?.peptide.name ?? "Oral dose",
      stackId: l.protocol?.stackId ?? null,
      stackName: l.protocol?.stack?.name ?? null,
      doseLabel: `${Number(l.doseMcg).toLocaleString()} mcg`,
      // Client-stamped local day is the travel-proof bucket; legacy rows fall
      // back to the runtime-TZ instant day.
      dateKey: l.localDay ?? KEY(t),
      doseLogId: l.id,
      // Wall clock where the dose was taken: stored tz when stamped, else the
      // runtime TZ (container TZ = the historical write TZ). Both branches are
      // 24h "HH:MM" so stamped and legacy rows match byte-for-byte at home;
      // the try/catch keeps one ICU-rejected stored tz from 500ing the page.
      time: ((): string => {
        const runtimeHHMM = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
        if (!l.tz) return runtimeHHMM;
        try {
          return timeInTz(t, l.tz);
        } catch {
          return runtimeHHMM;
        }
      })(),
    };
  });
}

export async function getTimeline(userId: string, rangeStart: Date, rangeEnd: Date): Promise<TimelineEntry[]> {
  const [occurrences, logs] = await Promise.all([
    buildResolvedOccurrences(userId, rangeStart, rangeEnd),
    buildLogs(userId, rangeStart, rangeEnd),
  ]);
  // Clip to the requested range: buildLogs over-fetches ±1 day (localDay can
  // sit a day from its instant), and an UNMATCHED out-of-range log would
  // otherwise surface as a taken_offschedule entry outside the grid — e.g. a
  // ghost peptide row with seven empty cells in the week view (DosesWeek
  // derives its row list from ALL entries). Lexical compare is safe for
  // zero-padded "YYYY-MM-DD" keys.
  const startKey = KEY(startOfDay(rangeStart));
  const endKey = KEY(startOfDay(rangeEnd));
  return buildTimelineEntries({ todayKey: KEY(new Date()), occurrences, logs }).filter(
    (e) => e.date >= startKey && e.date <= endKey,
  );
}

export async function getWeek(userId: string, weekStart: Date) {
  const end = addDays(weekStart, 6);
  const entries = await getTimeline(userId, weekStart, end);
  return { weekStart: KEY(weekStart), days: Array.from({ length: 7 }, (_, i) => KEY(addDays(weekStart, i))), entries };
}

export async function getMonth(userId: string, monthStart: Date) {
  const first = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  const gridStart = addDays(first, -((first.getDay() + 6) % 7)); // back to Monday
  const last = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const gridEnd = addDays(last, (7 - last.getDay()) % 7); // forward to Sunday
  const [entries, wearableRows] = await Promise.all([
    getTimeline(userId, gridStart, gridEnd),
    // Owner-scoped Garmin window over the full visible grid (local-midnight, inclusive).
    prisma.wearableDaily.findMany({
      where: { userId, source: "garmin", date: { gte: startOfDay(gridStart), lte: startOfDay(gridEnd) } },
      orderBy: { date: "asc" },
    }),
  ]);
  return {
    monthLabel: first.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    gridStart: KEY(gridStart),
    gridEnd: KEY(gridEnd),
    entries,
    metrics: monthMetricsByDay(wearableRows),
  };
}
