import { parseSchedule, slotsInRange } from "@/lib/schedule/entries";
import { addDays, startOfDay } from "@/lib/schedule/schedule";
import { dayAnchor } from "@/lib/tz-day";

export interface CompletionProtocolInput {
  id: string;
  status: string;
  scheduleRule: string | null;
  startDate: Date | null;
  endDate: Date | null;
  deliveredLogs: { takenAt: Date | string; localDay?: string | null }[];
}

export function protocolShouldAutoComplete(protocol: CompletionProtocolInput, today: Date): boolean {
  if (protocol.status !== "active") return false;
  if (!protocol.endDate) return false;

  const todayDay = startOfDay(today);
  const endDay = startOfDay(protocol.endDate);
  if (todayDay > endDay) return true;
  if (!protocol.scheduleRule) return todayDay >= endDay;

  const slots = slotsInRange(
    parseSchedule(protocol.scheduleRule),
    protocol.startDate ?? endDay,
    endDay,
    protocol.startDate,
    protocol.endDate,
  );
  if (slots.length === 0) return todayDay >= endDay;

  const deliveredDays = new Set(protocol.deliveredLogs.map((l) =>
    startOfDay(l.localDay ? dayAnchor(l.localDay) : new Date(l.takenAt)).getTime()
  ));
  const remaining = slots.some((slot) => {
    const day = startOfDay(slot.date);
    return day >= todayDay && !deliveredDays.has(day.getTime());
  });
  return !remaining;
}

export function autoCompleteProtocolIds(protocols: CompletionProtocolInput[], today: Date): string[] {
  return protocols.filter((p) => protocolShouldAutoComplete(p, today)).map((p) => p.id);
}
