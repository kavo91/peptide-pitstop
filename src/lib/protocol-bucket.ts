import { startOfDay } from "@/lib/schedule/schedule";

/** Display buckets for the protocols page.
 *
 *  `paused` and `completed` come straight off status. The rest are derived from
 *  dates, because a protocol queued to start later is still stored as `active`
 *  and would otherwise sit indistinguishable from one running right now. The
 *  `ended` bucket catches the inverse: still `active` but past its end date, so
 *  it can be closed off rather than silently lingering.
 */
export type ProtocolBucket = "active" | "scheduled" | "paused" | "ended" | "completed";

export type BucketInput = {
  status: string;
  startDate: Date | string | null;
  endDate: Date | string | null;
};

export function bucketOf(p: BucketInput, today: Date): ProtocolBucket {
  if (p.status === "completed") return "completed";
  if (p.status === "paused") return "paused";

  const start = p.startDate ? startOfDay(new Date(p.startDate)) : null;
  if (start && start.getTime() > today.getTime()) return "scheduled";

  const end = p.endDate ? startOfDay(new Date(p.endDate)) : null;
  if (end && end.getTime() < today.getTime()) return "ended";

  return "active";
}

export const PROTOCOL_SECTIONS: { key: ProtocolBucket; title: string; blurb: string }[] = [
  { key: "active", title: "Active", blurb: "Running now." },
  { key: "scheduled", title: "Scheduled", blurb: "Queued — starts on a future date." },
  { key: "paused", title: "Paused", blurb: "Temporarily stopped; resume when ready." },
  { key: "ended", title: "Past end date", blurb: "Still marked active but past its end date — close these off." },
  { key: "completed", title: "Completed", blurb: "Finished. Kept for history and adherence." },
];

export const PROTOCOL_SECTION_ACCENT: Record<ProtocolBucket, string> = {
  active: "bg-ok",
  scheduled: "bg-accent",
  paused: "bg-warn",
  ended: "bg-danger",
  completed: "bg-line",
};
