/**
 * Bloodwork — manual biomarker entry, per-biomarker trends, and a dated history
 * of lab panels. Encrypted values are decrypted here for display only.
 *
 * Reference only — not medical advice.
 */
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/owner";
import { prisma } from "@/lib/db";
import { decryptField } from "@/lib/crypto/fieldEncryption";
import { BIOMARKER_LIBRARY } from "@/lib/biomarker-library";
import { trendSeries, panelSummary, type ResultForTrend } from "@/lib/bloodwork";
import { BackButton } from "@/components/BackButton";
import { BloodworkAddPanel } from "@/components/BloodworkAddPanel";
import { BiomarkerTrend } from "@/components/BiomarkerTrend";
import { BloodworkMatrix } from "@/components/BloodworkMatrix";
import { DeleteLabPanelButton } from "@/components/DeleteLabPanelButton";
import { activeDesign } from "@/lib/design";
import { PAGE_MAIN } from "@/lib/layout";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Locale-independent date label (avoids SSR/browser locale hydration mismatch). */
function fmtDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function numOrNull(d: { toString(): string } | null | undefined): number | null {
  if (d == null) return null;
  const n = Number(d.toString());
  return Number.isFinite(n) ? n : null;
}

function flagBadge(flag: string | null): { cls: string; label: string } | null {
  switch (flag) {
    case "low": return { cls: "bg-danger/10 text-danger", label: "Low" };
    case "high": return { cls: "bg-danger/10 text-danger", label: "High" };
    case "borderline": return { cls: "bg-warn/10 text-warn", label: "Borderline" };
    case "normal": return { cls: "bg-ok/10 text-ok", label: "Normal" };
    default: return null;
  }
}

export default async function BloodworkPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const design = activeDesign();

  const panels = await prisma.labPanel.findMany({
    where: { userId: user.id },
    orderBy: { collectedDate: "desc" },
    include: { results: { include: { biomarker: true }, orderBy: { biomarker: { name: "asc" } } } },
  });

  // Decrypt for display (values + notes are encrypted at rest).
  const decoded = panels.map((p) => ({
    id: p.id,
    collectedDate: p.collectedDate,
    labSource: p.labSource,
    notes: decryptField(p.notes),
    results: p.results.map((r) => ({
      biomarkerName: r.biomarker.name,
      value: decryptField(r.value) ?? "",
      unit: r.unit ?? r.biomarker.defaultUnit ?? "",
      referenceLow: numOrNull(r.referenceLow),
      referenceHigh: numOrNull(r.referenceHigh),
      flag: r.flag,
    })),
  }));

  // Per-biomarker numeric trend series.
  const allResults: ResultForTrend[] = decoded.flatMap((p) =>
    p.results.map((r) => ({
      biomarkerName: r.biomarkerName,
      collectedDate: p.collectedDate,
      value: r.value,
      flag: r.flag,
    })),
  );
  const trends = trendSeries(allResults);

  // Pitstop-only: summarise the latest panel vs the prior one (read-only).
  const pit = design === "pitstop";
  const summary = panelSummary(decoded[0]?.results, decoded[1]?.results);

  // A biomarker with a single reading renders as a near-empty one-dot chart that
  // dominates page height on mobile. Under pitstop the comparison matrix already
  // shows that latest value, so skip those cards and only keep ≥2-reading trends.
  // "current" keeps every card (single-point charts included) — byte-identical.
  const visibleTrends = pit ? trends.filter((t) => t.points.length >= 2) : trends;

  // Meta (units + optimal + latest reference interval) for each biomarker. Panels
  // are date-desc, so the first occurrence of a name is its most recent reading.
  const metaByName = new Map<string, { unit: string | null; optimalLow: number | null; optimalHigh: number | null; refLow: number | null; refHigh: number | null }>();
  for (const p of panels) {
    for (const r of p.results) {
      if (metaByName.has(r.biomarker.name)) continue;
      metaByName.set(r.biomarker.name, {
        unit: r.unit ?? r.biomarker.defaultUnit ?? null,
        optimalLow: numOrNull(r.biomarker.optimalLow),
        optimalHigh: numOrNull(r.biomarker.optimalHigh),
        refLow: numOrNull(r.referenceLow),
        refHigh: numOrNull(r.referenceHigh),
      });
    }
  }

  const formBiomarkers = BIOMARKER_LIBRARY.map((b) => ({ name: b.name, defaultUnit: b.defaultUnit, category: b.category }));

  // Raw lab-panel history body — identical markup for both designs. Pitstop wraps
  // it in a collapsed <details> (it duplicates the matrix and is tall on mobile);
  // "current" keeps it as an open <section> below, so its DOM stays byte-identical.
  const panelsBody =
    decoded.length === 0 ? (
      <p className="rounded-card bg-surface p-4 text-sm text-muted ring-1 ring-line/10">
        No lab panels yet. Add one above to start tracking your biomarkers.
      </p>
    ) : (
      <div className="space-y-4">
        {decoded.map((p) => (
          <article key={p.id} className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
            <header className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">{fmtDate(p.collectedDate)}</p>
                {p.labSource && <p className="text-xs text-muted">{p.labSource}</p>}
              </div>
              <DeleteLabPanelButton id={p.id} label={fmtDate(p.collectedDate)} />
            </header>

            <ul className="divide-y divide-line/10">
              {p.results.map((r, i) => {
                const badge = flagBadge(r.flag);
                const range =
                  r.referenceLow != null || r.referenceHigh != null
                    ? `${r.referenceLow ?? ""}–${r.referenceHigh ?? ""}`
                    : null;
                return (
                  <li key={`${p.id}-${i}`} className="flex items-center justify-between gap-2 py-2">
                    <span className="text-sm text-ink">{r.biomarkerName}</span>
                    <span className="flex items-center gap-2">
                      {range && <span className="text-[11px] text-muted tabular-nums">ref {range}</span>}
                      <span className="text-sm tabular-nums">
                        {r.value}
                        {r.unit && <span className="ml-1 text-xs text-muted">{r.unit}</span>}
                      </span>
                      {badge && (
                        <span className={`rounded-control px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.label}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>

            {p.notes && <p className="mt-3 rounded-control bg-bg/40 px-3 py-2 text-xs text-muted">{p.notes}</p>}
          </article>
        ))}
      </div>
    );

  return (
    <main className={PAGE_MAIN}>
      <BackButton fallback="/more" />

      <BloodworkAddPanel design={design} pit={pit} biomarkers={formBiomarkers} defaultOpen={decoded.length === 0} />

      {pit && decoded.length > 0 && (
        <>
          {/* "N of M in range" summary card — at the top of the page */}
          {summary.total > 0 && (
            <div className="pitstop-slash-edge mb-8 flex items-center gap-3 rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
              <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden className="shrink-0">
                <circle cx="19" cy="19" r="16" fill="none" stroke="rgb(var(--ink) / 0.08)" strokeWidth="3.5" />
                <circle
                  cx="19"
                  cy="19"
                  r="16"
                  fill="none"
                  style={{ stroke: "rgb(var(--ok))" }}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 16}
                  strokeDashoffset={
                    2 * Math.PI * 16 * (1 - Math.max(0, Math.min(1, summary.inRange / summary.total)))
                  }
                  transform="rotate(-90 19 19)"
                />
              </svg>
              <div>
                <div className="font-mono text-[13px] text-ink tabular-nums">
                  {summary.inRange} of {summary.total} in range
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-ok tabular-nums">
                  {summary.improving} {summary.improving === 1 ? "analyte" : "analytes"} improving vs prior panel
                </div>
              </div>
              <span className="ml-auto rounded-control bg-ok/10 px-2 py-0.5 text-[11px] uppercase text-ok ring-1 ring-ok/40">
                Trend ▲
              </span>
            </div>
          )}

          {/* Last-3-panels comparison matrix (below the summary) */}
          <BloodworkMatrix panels={decoded} />
        </>
      )}

      {visibleTrends.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-medium text-muted">Trends</h2>
          <div
            className={
              pit
                ? "grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3"
                : "grid grid-cols-1 gap-4 lg:grid-cols-2"
            }
          >
            {visibleTrends.map((t) => {
              const meta = metaByName.get(t.biomarkerName);
              return (
                <BiomarkerTrend
                  key={t.biomarkerName}
                  name={t.biomarkerName}
                  unit={meta?.unit}
                  points={t.points}
                  referenceLow={meta?.refLow}
                  referenceHigh={meta?.refHigh}
                  optimalLow={meta?.optimalLow}
                  optimalHigh={meta?.optimalHigh}
                  design={design}
                />
              );
            })}
          </div>
        </section>
      )}

      {pit ? (
        <details open={decoded.length === 0}>
          <summary className="mb-3 cursor-pointer select-none text-sm font-medium text-muted">
            Lab panels
          </summary>
          {panelsBody}
        </details>
      ) : (
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted">Lab panels</h2>
          {panelsBody}
        </section>
      )}
    </main>
  );
}
