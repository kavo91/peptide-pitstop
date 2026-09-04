import Link from "next/link";
import type { NextDue, Precision, ScanValues } from "@/lib/body-comp-core";
import { CARD, fmtDate, maskSerial, precisionLabel } from "./format";

interface Props {
  scanCount: number;
  latest: ScanValues;
  nextDue: NextDue;
  precision: Precision;
}

function dueLine(d: NextDue): string {
  const window = `${fmtDate(d.dueStart)} – ${fmtDate(d.dueEnd)}`;
  switch (d.status) {
    case "upcoming": return `${window} · ${d.daysToStart} days until the window opens`;
    case "in_window": return `${window} · window open now`;
    case "window_passed": return `${window} · window passed`;
  }
}

/** Section 0 — scan count, latest scan, device/software, next-scan window, disclaimer link. */
export function BodyHeaderStrip({ scanCount, latest, nextDue, precision }: Props) {
  return (
    <div className={`${CARD} mb-6`}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">Scans</dt>
          <dd className="font-semibold tabular-nums text-ink">{scanCount}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">Latest scan</dt>
          <dd className="font-semibold text-ink">{fmtDate(latest.scannedAt)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">Scanner</dt>
          <dd className="text-ink">
            {maskSerial(latest.deviceSerial)}
            <span className="block text-xs text-muted">{latest.softwareVersion ? `software ${latest.softwareVersion}` : "software not recorded"}</span>
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">Next scan window</dt>
          <dd className="text-ink">{dueLine(nextDue)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted">
        Noise bands: {precisionLabel(precision)} · <a href="#disclaimer" className="underline">disclaimer</a> ·{" "}
        <Link href="/body/new" className="underline">add a scan</Link> · <Link href="/body/prep" className="underline">pre-visit checklist</Link>
      </p>
    </div>
  );
}
