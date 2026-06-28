"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { HeatmapBucket } from "@/lib/analytics-core";

interface Props {
  buckets: HeatmapBucket[];
  /** All dose log entries for DayDetail (simplified: just date + count). */
  nowKey: string;
}

const DOW_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

/** Monday-first day index (0=Mon … 6=Sun). */
function mondayIndex(dateKey: string): number {
  const d = new Date(dateKey + "T00:00:00");
  return (d.getDay() + 6) % 7;
}

function intensityClass(count: number, max: number): string {
  if (count === 0) return "bg-line/[0.05]";
  if (max === 0) return "bg-accent/20";
  const ratio = count / max;
  if (ratio < 0.25) return "bg-accent/20";
  if (ratio < 0.5) return "bg-accent/40";
  if (ratio < 0.75) return "bg-accent/65";
  return "bg-accent";
}

export function HeatmapGrid({ buckets, nowKey }: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const max = Math.max(...buckets.map((b) => b.count), 1);

  // Build a Monday-first grid. Find the first Monday at or before buckets[0].
  const firstKey = buckets[0]?.dateKey ?? nowKey;
  const firstDate = new Date(firstKey + "T00:00:00");
  const prefixDays = mondayIndex(firstKey);
  const gridStart = new Date(firstDate);
  gridStart.setDate(gridStart.getDate() - prefixDays);

  // Build grid cells (leading empties + real buckets)
  const cells: ({ dateKey: string; count: number } | null)[] = [];
  for (let i = 0; i < prefixDays; i++) cells.push(null);
  for (const b of buckets) cells.push(b);
  // Pad to complete the last row (multiple of 7)
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedBucket = selectedKey ? buckets.find((b) => b.dateKey === selectedKey) : null;

  return (
    // aspect-square cells scale with width, so the heatmap must NOT widen on
    // desktop (it would render giant squares). Cap at the mobile width and centre
    // it in the wider analytics card so cells stay their designed size.
    <div className="mx-auto max-w-md">
      {/* DOW header */}
      <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] text-muted">
        {DOW_LABELS.map((d, i) => <span key={i}>{d}</span>)}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((cell, i) => {
          if (!cell) {
            return <div key={`empty-${i}`} className="aspect-square rounded-sm" />;
          }
          const isToday = cell.dateKey === nowKey;
          return (
            <button
              key={cell.dateKey}
              type="button"
              title={`${cell.dateKey}: ${cell.count} dose${cell.count === 1 ? "" : "s"}`}
              aria-label={`${cell.dateKey}: ${cell.count} dose${cell.count === 1 ? "" : "s"}`}
              onClick={() => setSelectedKey(cell.dateKey)}
              className={[
                "aspect-square rounded-sm transition-opacity",
                intensityClass(cell.count, max),
                isToday ? "ring-1 ring-inset ring-accent" : "",
              ].join(" ")}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-2 flex items-center gap-1 text-[10px] text-muted">
        <span>Less</span>
        {["bg-line/[0.05]", "bg-accent/20", "bg-accent/40", "bg-accent/65", "bg-accent"].map((cls, i) => (
          <span key={i} className={`inline-block h-3 w-3 rounded-sm ${cls}`} />
        ))}
        <span>More</span>
      </div>

      {/* Day detail modal */}
      {selectedKey &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-20 flex items-end bg-black/30"
            onClick={() => setSelectedKey(null)}
          >
            <div
              className="mx-auto w-full max-w-md rounded-t-card bg-surface p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="mb-3 font-medium">
                {new Date(selectedKey + "T00:00:00").toLocaleDateString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </p>
              <p className="text-sm text-muted">
                {selectedBucket?.count ?? 0} dose{(selectedBucket?.count ?? 0) === 1 ? "" : "s"} logged
              </p>
              <button
                type="button"
                onClick={() => setSelectedKey(null)}
                className="mt-4 w-full rounded-control bg-bg py-2 text-sm ring-1 ring-line/15"
              >
                Close
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
