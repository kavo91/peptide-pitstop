"use client";

import { FileText } from "lucide-react";
import { useState } from "react";

const input = "w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink";

/** Container/browser-local YYYY-MM-DD. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Date-ranged "Download PDF report" control for Settings -> Data export.
 * Defaults to the last 90 days; the link hits `/api/export/report?from=&to=`,
 * which streams an `application/pdf` attachment (session-authed by cookie).
 */
export function ReportExportForm() {
  const today = new Date();
  const ninetyAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
  const [from, setFrom] = useState(ymd(ninetyAgo));
  const [to, setTo] = useState(ymd(today));

  const href = `/api/export/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  return (
    <div className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
      <p className="font-medium">Doctor report (PDF)</p>
      <p className="mb-3 text-sm text-muted">Dose log, side-effects, wellness &amp; lab panels over a date range.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-xs text-muted">
          From
          <input
            type="date"
            className={input + " mt-1 w-40"}
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="block text-xs text-muted">
          To
          <input
            type="date"
            className={input + " mt-1 w-40"}
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <a
          href={href}
          download
          className="inline-flex items-center gap-1.5 rounded-control bg-accent px-4 py-2 text-sm font-medium text-onAccent"
        >
          <FileText className="h-4 w-4" aria-hidden /> Download PDF report
        </a>
      </div>
    </div>
  );
}
