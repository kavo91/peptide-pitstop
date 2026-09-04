/**
 * Body composition — DEXA + RMR dashboard. Shows measurements and what was
 * logged alongside them; nothing here attributes a change to any compound, food,
 * training or event. Every report number is decrypted in the data layer only.
 *
 * States by scan count: n = 0 reference/empty; n = 1 baseline with forward
 * noise bands and no deltas; n ≥ 2 deltas, intervals and a disabled
 * correlation stub listing its unmet preconditions.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/owner";
import { getBodyDashboardData } from "@/lib/bodycomp-data";
import { sweepOrphanDocuments } from "@/lib/document-sweep";
import { activeDesign } from "@/lib/design";
import { PAGE_MAIN } from "@/lib/layout";
import { BackButton } from "@/components/BackButton";
import { PitstopHeading } from "@/components/PitstopHeading";
import { BodyHeaderStrip } from "@/components/body/BodyHeaderStrip";
import { ScanSeries } from "@/components/body/ScanSeries";
import { DeltaTable } from "@/components/body/DeltaTable";
import { ExposureLedger } from "@/components/body/ExposureLedger";
import { IntervalTable } from "@/components/body/IntervalTable";
import { LifeEventForm } from "@/components/body/LifeEventForm";
import { LifeEventList } from "@/components/body/LifeEventList";
import { NearestLabs } from "@/components/body/NearestLabs";
import { RmrPanel } from "@/components/body/RmrPanel";
import { ScanDetail } from "@/components/body/ScanDetail";
import { BodyFooter } from "@/components/body/BodyFooter";
import { BodyFigureCard } from "@/components/body/BodyFigureCard";
import { CARD, PILL, fmtDate } from "@/components/body/format";
import { buildBodyFigureModel } from "@/lib/body-figure-core";
import { BODY_COPY } from "@/lib/bodycomp-copy";

export const dynamic = "force-dynamic";

const CORRELATION_PRECONDITIONS = [
  "≥ 5 comparable intervals",
  "same device/software",
  "prep matched",
  "intake ≥ 80 % logged in every interval",
  "exposure varies",
  "≥ 1 interval beyond practical LSC",
  "illness/travel logged",
];

/** CSV exports (decrypted, flattened; no serial, no report JSON, no notes). */
const EXPORTS = [
  { type: "bodycomp", label: "Export scans (CSV)" },
  { type: "rmr", label: "Export RMR (CSV)" },
];

export default async function BodyPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const design = activeDesign();
  // Stale-pending sweep: uploads abandoned in a closed tab are removed here rather than kept indefinitely.
  await sweepOrphanDocuments(user.id).catch((e) => console.error("BodyPage: orphan sweep failed", e));
  const data = await getBodyDashboardData(user.id, new Date());
  const n = data.scans.length;
  const latestInterval = data.intervals[data.intervals.length - 1] ?? null;
  const ffmScan = data.rmr?.ffmScanId ? data.scans.find((s) => s.id === data.rmr?.ffmScanId) ?? null : null;
  // Regional figure for the latest scan (with change vs the previous scan when the pair is comparable); null without a scan.
  const figure = data.latest
    ? buildBodyFigureModel(data.latest.scan, { prev: n >= 2 ? data.scans[n - 2] : null, precision: data.precision, comparability: latestInterval?.comparability ?? null })
    : null;

  return (
    <main className={PAGE_MAIN}>
      <BackButton fallback="/more" />
      <PitstopHeading title="Body" index={12} design={design} className="mb-1 text-3xl font-semibold tracking-tight" split={["BO", "DY"]} />
      <p className="mb-6 text-muted max-[640px]:hidden">DEXA and RMR measurements, with what was logged alongside them.</p>

      {n === 0 && (
        <>
          <div className={`${CARD} mb-6`}>
            <p className="font-semibold text-ink">Add your first DEXA</p>
            <p className="mt-1 text-sm text-muted">
              Every scanner carries measurement noise, and the least significant change (LSC) is the smallest difference between two
              scans that is larger than that noise. Until a second scan exists every value is a reference point, and only later
              differences beyond the LSC count as change.
            </p>
            <p className="mt-3 flex flex-wrap gap-3 text-sm">
              <Link href="/body/new" className="rounded-control bg-accent px-3 py-1.5 font-medium text-onAccent">Add a scan</Link>
              <Link href="/body/prep" className="rounded-control bg-surface px-3 py-1.5 font-medium text-ink ring-1 ring-line/10">Pre-visit checklist</Link>
            </p>
          </div>
          {data.bia && (data.bia.weight.kept.length > 0 || data.bia.raw.length > 0) && (
            <ScanSeries scans={[]} tests={data.tests} precision={data.precision} bia={data.bia} showBia={false} lifeEvents={data.lifeEvents} />
          )}
          <p className="mb-6 text-xs text-muted">
            Garmin scale body-fat readings are uncalibrated bioimpedance until a DEXA exists to offset them; they are drawn raw above, not as a body-fat measurement.
          </p>
          {data.rmr && <RmrPanel rmr={data.rmr} tests={data.tests} ffmScanDate={null} />}
        </>
      )}

      {n >= 1 && data.latest && (
        <>
          <BodyHeaderStrip scanCount={n} latest={data.latest.scan} nextDue={data.latest.nextDue} precision={data.precision} />
          {figure && figure.regions.length > 0 && <BodyFigureCard model={figure} />}
          <ScanSeries scans={data.scans} tests={data.tests} precision={data.precision} bia={data.bia} showBia={n >= 2} lifeEvents={data.lifeEvents} />

          {n >= 2 && latestInterval && <DeltaTable interval={latestInterval} tests={data.tests} scans={data.scans} />}

          {n >= 2 && data.bia && data.bia.offsetPts != null && (
            <p className="-mt-4 mb-8 text-xs text-muted">
              Scale offset to the latest DEXA: {data.bia.offsetPts > 0 ? "+" : ""}{data.bia.offsetPts.toFixed(1)} points on {fmtDate(new Date(`${data.bia.scaleDay}T00:00:00`))}.
            </p>
          )}

          {n >= 2 && <IntervalTable intervals={data.intervals} />}

          <section className="mb-8">
            <h2 className="mb-1 text-sm font-medium text-muted">{BODY_COPY.lifeEventsTitle}</h2>
            <p className="mb-3 text-xs text-muted">{BODY_COPY.lifeEventsIntro}</p>
            <div className={`${CARD} space-y-4`}>
              <LifeEventList events={data.lifeEvents} />
              <LifeEventForm />
            </div>
          </section>

          {n >= 2 && latestInterval && (
            <ExposureLedger rows={latestInterval.exposure} from={latestInterval.from.scannedAt} to={latestInterval.to.scannedAt} label="latest interval" />
          )}
          {data.preBaseline && (
            <ExposureLedger rows={data.preBaseline.exposure} from={data.preBaseline.from} to={data.preBaseline.to} label={BODY_COPY.noComparator} />
          )}

          <NearestLabs labs={data.labs} scanDate={data.latest.scan.scannedAt} />
          <RmrPanel rmr={data.rmr} tests={data.tests} ffmScanDate={ffmScan?.scannedAt ?? null} />

          <section className="mb-8">
            <h2 className="mb-3 text-sm font-medium text-muted">Scans</h2>
            {[...data.scans].reverse().map((s, i) => <ScanDetail key={s.id} scan={s} open={i === 0 && n === 1} />)}
          </section>

          {n >= 2 && (
            <section className="mb-8">
              <div className={`${CARD} opacity-70`} role="group" aria-label="Correlation (disabled)" aria-disabled="true">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-ink">Correlation</p>
                  <span className={`${PILL} bg-line/[0.08] text-muted`}>disabled</span>
                </div>
                <p className="mt-1 text-xs text-muted">Available only when all of these hold:</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-muted">
                  {CORRELATION_PRECONDITIONS.map((c) => <li key={c}>{c}</li>)}
                </ul>
              </div>
            </section>
          )}
        </>
      )}

      <p className="text-xs text-muted">
        <Link href="/body/new" className="underline">Add a scan or RMR test</Link> · <Link href="/body/prep" className="underline">Pre-visit checklist</Link> ·{" "}
        {EXPORTS.map((e, i) => (
          <span key={e.type}>
            {i > 0 && " · "}
            <a href={`/api/export/${e.type}`} download className="underline">{e.label}</a>
          </span>
        ))}
      </p>
      <BodyFooter />
    </main>
  );
}
