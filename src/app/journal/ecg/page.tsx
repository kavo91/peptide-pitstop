/**
 * Every imported ECG recording, newest first.
 *
 * The list carries no traces — a 30-second trace is thousands of points, and a
 * page of them would be megabytes for a view whose job is "which recording?".
 * The newest one is drawn in full because that is the one usually wanted; the
 * rest link to their own page.
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/owner";
import { getEcgHistory, getLatestEcg } from "@/lib/ecg";
import { EcgRecordingCard, formatRecordedAt } from "@/components/wellness/EcgSection";
import { symptomsLabel } from "@/lib/ecg-parse-core";
import { EcgUpload } from "@/components/wellness/EcgUpload";
import { BackButton } from "@/components/BackButton";
import { PitstopHeading } from "@/components/PitstopHeading";
import { activeDesign } from "@/lib/design";
import { PAGE_MAIN } from "@/lib/layout";

export const dynamic = "force-dynamic";

const PILL = "inline-block whitespace-nowrap rounded-control px-1.5 py-0.5 text-[10px] font-medium";

export default async function EcgListPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [latest, history] = await Promise.all([getLatestEcg(user.id), getEcgHistory(user.id, 200)]);
  const earlier = history.filter((h) => h.id !== latest?.id);

  return (
    <main className={PAGE_MAIN}>
      <BackButton fallback="/journal" />
      <div className="mb-6">
        {/* No two-part split: "E/CG" reads as nonsense. A three-letter title
            takes the plain form, and 13 is the next unused race number. */}
        <PitstopHeading title="ECG" index={13} design={activeDesign()} className="text-3xl font-semibold tracking-tight" />
        <p className="text-muted">
          {history.length > 0
            ? `${history.length} recording${history.length === 1 ? "" : "s"} imported from Garmin Connect.`
            : "Single-lead recordings imported from Garmin Connect."}
        </p>
      </div>

      <div className="space-y-6">
        {latest ? (
          <section>
            <h2 className="mb-2 text-lg font-medium">Most recent</h2>
            <EcgRecordingCard recording={latest} detailHref={`/journal/ecg/${latest.id}`} />
          </section>
        ) : (
          <div className="rounded-card bg-surface p-8 text-center shadow-sm ring-1 ring-line/10">
            <p className="text-sm font-medium text-ink">Nothing imported yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
              Open the recording in Garmin Connect, share it as a PDF, and bring the file here.
            </p>
          </div>
        )}

        {earlier.length > 0 && (
          <section>
            <h2 className="mb-2 text-lg font-medium">Earlier</h2>
            <ul className="divide-y divide-line/10 rounded-card bg-surface px-4 shadow-sm ring-1 ring-line/10">
              {earlier.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/journal/ecg/${r.id}`}
                    className="-mx-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-control px-2 py-3 hover:bg-bg"
                  >
                    <span className="text-sm font-medium text-ink">{r.result}</span>
                    <span className="flex flex-wrap items-baseline gap-x-3 text-xs tabular-nums text-muted">
                      {r.avgHeartRateBpm != null && <span>{r.avgHeartRateBpm} bpm</span>}
                      {symptomsLabel(r.symptoms).reported && (
                        <span className={`${PILL} max-w-[12rem] truncate bg-warn/10 text-warn`}>{symptomsLabel(r.symptoms).text}</span>
                      )}
                      <span>{formatRecordedAt(r.recordedAt, r.tz)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-2 text-lg font-medium">Import</h2>
          <EcgUpload />
        </section>
      </div>
    </main>
  );
}
