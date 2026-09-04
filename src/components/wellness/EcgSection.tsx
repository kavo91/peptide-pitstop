/**
 * "ECG" section of the Wellness screen.
 *
 * Sits beside the wearable charts because it is the same picture: the same
 * watch, the same day, the same person's week. It is its own section rather
 * than a tile in the wearable grid because it does not come from the sync — it
 * arrives as a report you import, and it is the only card here that carries a
 * control.
 *
 * Everything printed is Garmin's own wording. The app draws the trace and shows
 * the numbers; it does not say what any of it means.
 *
 * Server component.
 */
import Link from "next/link";
import { FileText, HeartPulse } from "lucide-react";
import { symptomsLabel } from "@/lib/ecg-parse-core";
import type { EcgRecordingDetail, EcgRecordingSummary } from "@/lib/ecg";
import { EcgTrace } from "./EcgTrace";
import { EcgUpload } from "./EcgUpload";

const PILL = "inline-block whitespace-nowrap rounded-control px-1.5 py-0.5 text-[10px] font-medium";

/** Date and time in the zone the recording was made in — not the reader's. */
export function formatRecordedAt(at: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(at);
  } catch {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(at);
  }
}

function Stat({ k, v, sub, wrap = false }: { k: string; v: string; sub?: string | null; wrap?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{k}</dt>
      {/* Values wrap rather than clip: a half-printed number on a health surface
          is a defect. A measurement is held nowrap so a wrap falls between the
          number and its unit, never inside the number — but free text from the
          report (`wrap`) has to break anywhere, or a long symptom list pushes
          the card wider than the screen. */}
      <dd className="flex flex-wrap items-baseline gap-x-1 text-sm font-semibold tabular-nums text-ink">
        <span className={wrap ? "break-words" : "whitespace-nowrap"}>{v}</span>
        {sub ? <span className="whitespace-nowrap text-xs font-normal text-muted">{sub}</span> : null}
      </dd>
    </div>
  );
}

/**
 * One imported recording, in full: what Garmin found, and the trace it drew.
 *
 * `detailHref` links the heading to this recording's own page. Without it the
 * newest recording — the one shown in full everywhere — has no route to its own
 * page and so no way to be deleted; only the older rows in the list are links.
 */
export function EcgRecordingCard({
  recording,
  headingLevel = 3,
  detailHref,
}: {
  recording: EcgRecordingDetail;
  headingLevel?: 2 | 3;
  detailHref?: string;
}) {
  const Heading = (headingLevel === 2 ? "h2" : "h3") as "h2" | "h3";
  const when = formatRecordedAt(recording.recordedAt, recording.tz);
  const title = (
    <>
      <HeartPulse className="mr-1 inline h-4 w-4 align-[-0.15em] text-accentStrong" aria-hidden />
      {recording.result}
    </>
  );
  return (
    <article className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Heading className="text-sm font-semibold text-ink">
          {detailHref ? (
            <Link href={detailHref} className="hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </Heading>
        <span className="text-xs tabular-nums text-muted">{when}</span>
      </div>

      <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Stat k="Average heart rate" v={recording.avgHeartRateBpm == null ? "—" : String(recording.avgHeartRateBpm)} sub={recording.avgHeartRateBpm == null ? null : "bpm"} />
        <Stat k="Symptoms" v={symptomsLabel(recording.symptoms).text} wrap />
        <Stat k="Length" v={recording.durationSec == null ? "—" : String(recording.durationSec)} sub={recording.durationSec == null ? null : "s"} />
        <Stat k="Sample rate" v={recording.sampleRateHz == null ? "—" : String(recording.sampleRateHz)} sub={recording.sampleRateHz == null ? null : "Hz"} />
      </dl>

      {recording.interpretation && (
        <p className="mb-3 rounded-control bg-bg px-3 py-2 text-sm text-ink ring-1 ring-line/10">{recording.interpretation}</p>
      )}

      {recording.waveform ? (
        <EcgTrace
          waveform={recording.waveform}
          mmPerSec={recording.paperSpeedMmS}
          mmPerMv={recording.gainMmMv}
          id={`ecg-${recording.id}`}
          label={`ECG trace, ${recording.result}, recorded ${when}`}
        />
      ) : (
        <p className="py-4 text-center text-sm text-muted">The trace could not be read from this report.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/10 pt-3 text-[11px] text-muted">
        {recording.leadNote && <span>{recording.leadNote}</span>}
        {recording.deviceModel && (
          <span className={`${PILL} bg-line/[0.08] text-muted`}>
            {recording.deviceModel}
            {recording.deviceSoftware ? ` · ${recording.deviceSoftware}` : ""}
          </span>
        )}
        {recording.documentId && (
          <a
            href={`/api/documents/${recording.documentId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-accentStrong hover:underline"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden />
            Garmin&apos;s own report (PDF)
          </a>
        )}
      </div>
    </article>
  );
}

/** Compact row for a recording that is not the one being drawn. */
function HistoryRow({ recording }: { recording: EcgRecordingSummary }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
      <span className="text-sm font-medium text-ink">{recording.result}</span>
      <span className="flex flex-wrap items-baseline gap-x-3 text-xs tabular-nums text-muted">
        {recording.avgHeartRateBpm != null && <span>{recording.avgHeartRateBpm} bpm</span>}
        {symptomsLabel(recording.symptoms).reported && (
          <span className={`${PILL} max-w-[12rem] truncate bg-warn/10 text-warn`}>{symptomsLabel(recording.symptoms).text}</span>
        )}
        <span>{formatRecordedAt(recording.recordedAt, recording.tz)}</span>
      </span>
    </li>
  );
}

export interface EcgSectionProps {
  latest: EcgRecordingDetail | null;
  history: EcgRecordingSummary[];
  total: number;
}

export function EcgSection({ latest, history, total }: EcgSectionProps) {
  const earlier = history.filter((h) => h.id !== latest?.id);

  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">ECG</h2>
          <p className="text-sm text-muted">
            {total > 0
              ? `${total} recording${total === 1 ? "" : "s"} from your watch.`
              : "Single-lead recordings from your watch."}
          </p>
        </div>
        {total > 1 && (
          <Link href="/journal/ecg" className="whitespace-nowrap text-sm font-medium text-accentStrong hover:underline">
            All recordings →
          </Link>
        )}
      </div>

      <div className="space-y-4">
        {latest ? (
          <EcgRecordingCard recording={latest} detailHref={`/journal/ecg/${latest.id}`} />
        ) : (
          <div className="rounded-card bg-surface p-8 text-center shadow-sm ring-1 ring-line/10">
            <p className="text-sm font-medium text-ink">No ECG recordings yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
              Garmin keeps ECG recordings in the phone app and offers no other way out, so they arrive here as the
              PDF it shares. Import one below and it is read for you.
            </p>
          </div>
        )}

        {earlier.length > 0 && (
          <div className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
            <h3 className="mb-1 text-sm font-semibold text-ink">Earlier recordings</h3>
            <ul className="divide-y divide-line/10">
              {earlier.map((r) => (
                <HistoryRow key={r.id} recording={r} />
              ))}
            </ul>
            {total > history.length && (
              <Link href="/journal/ecg" className="mt-2 inline-block text-xs font-medium text-accentStrong hover:underline">
                {total - history.length} more →
              </Link>
            )}
          </div>
        )}

        <EcgUpload compact={latest != null} />
      </div>
    </section>
  );
}
