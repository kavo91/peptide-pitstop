import { getCurrentUser } from "@/lib/auth/owner";
import { getAnalyticsData, getInsightsData } from "@/lib/analytics";
import { BackButton } from "@/components/BackButton";
import { AdherenceCard } from "@/components/AdherenceCard";
import { HeatmapGrid } from "@/components/HeatmapGrid";
import { MultiPlasmaChart } from "@/components/MultiPlasmaChart";
import { InsightsCard } from "@/components/InsightsCard";
import { PitstopHeading } from "@/components/PitstopHeading";
import { activeDesign } from "@/lib/design";
import { PAGE_MAIN } from "@/lib/layout";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** YYYY-MM-DD for a Date in local time. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const data = await getAnalyticsData(user.id);
  const insights = await getInsightsData(user.id, data.overallAdherence.adherencePct);
  const nowKey = ymd(data.now);
  const design = activeDesign();

  const heatmapFromLabel = data.heatmapFrom.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <main className={PAGE_MAIN}>
      <BackButton fallback="/more" />

      <PitstopHeading title="Analytics" index={6} design={design} className="mb-1 text-3xl font-semibold tracking-tight" split={["ANA", "LYTICS"]} />
      <p className="mb-6 text-sm text-muted">
        Dose history, adherence, and estimated plasma levels.
        <span className="block text-xs">Not medical advice.</span>
      </p>

      {/* ── Dose history + adherence — side-by-side on desktop to cut height ──
          Each grid child zeroes its trailing margin at lg (lg:mb-0) and the block's
          bottom spacing moves to the grid container (lg:mb-6). Asymmetric child
          margins (mb-6 vs mb-4) previously made the stretched cards differ by 8px;
          equalising the margins lets items-stretch align both card bottoms exactly. */}
      <div className="lg:mb-6 lg:grid lg:grid-cols-2 lg:items-stretch lg:gap-6">
        {/* Heatmap (windowed to actual data; hidden until first dose) */}
        {data.heatmap.length > 0 && (
          <section className="mb-6 lg:mb-0 lg:flex lg:flex-col">
            <h2 className="mb-2 text-sm font-semibold">Dose history</h2>
            <div className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10 lg:grow">
              <HeatmapGrid buckets={data.heatmap} nowKey={nowKey} />
              <p className="mt-2 text-[10px] text-muted">Since {heatmapFromLabel}</p>
            </div>
          </section>
        )}

        {/* Adherence (overall + per-peptide) */}
        <div className="lg:flex lg:flex-col">
          <section className="mb-4 lg:mb-0 lg:flex lg:grow lg:flex-col">
            <h2 className="mb-2 text-sm font-semibold">Adherence (90 days)</h2>
            {design === "pitstop" ? (
              // Fluid radial gauges that resize to fit the card: Overall is the
              // large hero, per-peptide gauges fill a responsive grid below.
              <div className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10 lg:grow">
                {/* Overall "hero" gauge. The fluid gauge fills its container up to the
                    xl cap, so a responsive container width keeps it COMPACT on mobile
                    (~96px, just above the per-peptide gauges) and only blows it up to
                    the full hero dial at lg+ (laptop/desktop). */}
                <div className="mb-4 flex justify-center">
                  <div className="w-24 lg:w-[150px]">
                    <AdherenceCard adherence={data.overallAdherence} design={design} size="xl" fluid />
                  </div>
                </div>
                {data.adherenceByPeptide.length > 1 && (
                  // Mobile: a centered flex-wrap so a partial last row (e.g. 5 in 3s →
                  // 3 + 2) centres instead of sitting ragged-left. sm+ keeps the tidy
                  // 5-up grid. Each item is width-capped so 3 sit per row on a phone.
                  <div className="flex flex-wrap justify-center gap-3 sm:grid sm:grid-cols-5">
                    {data.adherenceByPeptide.map((pa) => (
                      <div key={pa.peptideId} className="w-[28%] sm:w-auto">
                        <AdherenceCard peptideName={pa.peptideName} adherence={pa.adherence} design={design} size="md" fluid />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <AdherenceCard adherence={data.overallAdherence} />
            )}
          </section>

          {design !== "pitstop" && data.adherenceByPeptide.length > 1 && (
            <section className="mb-6">
              <div className="grid gap-2 sm:grid-cols-2">
                {data.adherenceByPeptide.map((pa) => (
                  <AdherenceCard
                    key={pa.peptideId}
                    peptideName={pa.peptideName}
                    adherence={pa.adherence}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* ── Plasma curves + insights ─────────────────────────────────────────
          On mobile these stack in DOM order (Plasma then Insights) exactly as
          before. At ≥lg they sit side-by-side — Plasma takes 2/3 (the SVG scales
          undistorted to its container), Insights 1/3 — so the tall plasma block
          and the Insights list no longer stack into a long single-column tail.
          When there's no plasma data, Insights spans the full width. */}
      <div className="mb-6 lg:grid lg:grid-cols-3 lg:items-stretch lg:gap-6">
        {data.plasmaByPeptide.length > 0 && (
          <section className="mb-6 lg:col-span-2 lg:mb-0 lg:flex lg:flex-col">
            <h2 className="mb-2 text-sm font-semibold">
              Plasma curve estimate (±30 days around today)
            </h2>
            <div className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10 lg:grow">
              <MultiPlasmaChart
                plasmaByPeptide={data.plasmaByPeptide}
                now={data.now}
                design={design}
                missedDoses={data.missedDoseTimes}
              />
            </div>
          </section>
        )}

        {/* ── Cross-metric insights ──────────────────────────────────────── */}
        <section className={`mb-6 lg:mb-0 lg:flex lg:flex-col ${data.plasmaByPeptide.length === 0 ? "lg:col-span-3" : ""}`}>
          <h2 className="mb-2 text-sm font-semibold">Insights</h2>
          <InsightsCard insights={insights} />
        </section>
      </div>

      {/* ── No-half-life hints ───────────────────────────────────────────── */}
      {data.peptidesWithoutHalfLife.length > 0 && (
        <section className="mb-6">
          <div className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
            <p className="text-sm font-medium">Plasma curve unavailable</p>
            <ul className="mt-1 space-y-0.5 text-sm text-muted">
              {data.peptidesWithoutHalfLife.map((p) => (
                <li key={p.peptideId}>
                  {p.peptideName} — set a half-life in Settings to see an estimate.
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ── Empty state ──────────────────────────────────────────────────── */}
      {data.heatmap.every((b) => b.count === 0) &&
        data.plasmaByPeptide.length === 0 &&
        data.peptidesWithoutHalfLife.length === 0 && (
          <p className="text-center text-sm text-muted">
            No dose history yet. Start logging doses to see analytics.
          </p>
        )}
    </main>
  );
}
