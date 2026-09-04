/**
 * Section 6 — the bloodwork panel nearest the latest scan (± 30 days). Fixed
 * subset, fixed order; a panel drawn weeks from the scan is not a scan-day panel,
 * so the distance is always printed.
 */
import Link from "next/link";
import type { NearestLabs as NearestLabsData } from "@/lib/bodycomp-data";
import { BODY_COPY } from "@/lib/bodycomp-copy";
import { CARD, fmtDate, labFlagBadge } from "./format";

export function NearestLabs({ labs, scanDate }: { labs: NearestLabsData | null; scanDate: Date }) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-medium text-muted">Nearest bloodwork panel</h2>
      <p className="mb-3 text-xs text-muted">Within ± 30 days of the scan on {fmtDate(scanDate)}.</p>
      <div className={CARD}>
        {!labs ? (
          <p className="text-sm text-muted">
            No lab panel within 30 days of this scan. <Link href="/bloodwork" className="underline">Bloodwork</Link>
          </p>
        ) : (
          <>
            <header className="mb-2 flex items-baseline justify-between gap-2">
              <p className="font-semibold text-ink">{fmtDate(labs.panelDate)}</p>
              <p className="text-xs text-muted tabular-nums">
                {labs.daysFromScan === 0 ? "scan day" : `${Math.abs(labs.daysFromScan)} days ${labs.daysFromScan < 0 ? "before" : "after"} the scan`}
                {labs.labSource ? ` · ${labs.labSource}` : ""}
              </p>
            </header>
            <ul className="divide-y divide-line/10">
              {labs.rows.map((r) => {
                const badge = labFlagBadge(r.flag);
                // One-sided ranges print as "≤ 4" / "≥ 49" — a dangling dash reads as a minus sign.
                const range =
                  r.referenceLow != null && r.referenceHigh != null ? `${r.referenceLow}–${r.referenceHigh}`
                  : r.referenceLow != null ? `≥ ${r.referenceLow}`
                  : r.referenceHigh != null ? `≤ ${r.referenceHigh}`
                  : null;
                return (
                  <li key={r.label} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="text-sm text-ink">{r.label}</span>
                    {r.status === "present" ? (
                      <span className="flex items-center gap-2">
                        {range && <span className="text-[11px] text-muted tabular-nums">ref {range}</span>}
                        <span className="text-sm tabular-nums">
                          {r.value ?? "—"}
                          {r.unit && <span className="ml-1 text-xs text-muted">{r.unit}</span>}
                        </span>
                        {badge && <span className={`rounded-control px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.label}</span>}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">{r.status === "never_measured" ? BODY_COPY.neverMeasured : "not measured in this panel"}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {labs.notes && labs.notes.trim() !== "" && (
              <p className="mt-3 rounded-control bg-bg/40 px-3 py-2 text-xs text-muted">{labs.notes}</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
