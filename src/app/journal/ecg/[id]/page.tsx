/**
 * One imported ECG recording, in full: Garmin's findings, the trace redrawn,
 * the report itself, and where the record came from.
 *
 * The provenance block exists because the parser reads a fixed page layout.
 * `PDF Template` is the version of that layout, so when a future export stops
 * parsing, the row that still works and the row that does not can be compared
 * directly.
 */
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/owner";
import { getEcgRecording } from "@/lib/ecg";
import { EcgRecordingCard, formatRecordedAt } from "@/components/wellness/EcgSection";
import { EcgDeleteButton } from "@/components/wellness/EcgDeleteButton";
import { BackButton } from "@/components/BackButton";
import { PAGE_MAIN } from "@/lib/layout";

export const dynamic = "force-dynamic";

export default async function EcgRecordingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const recording = await getEcgRecording(user.id, id);
  if (!recording) notFound();

  const provenance: { k: string; v: string }[] = [
    { k: "Recorded", v: `${formatRecordedAt(recording.recordedAt, recording.tz)} (${recording.tz})` },
    { k: "Device", v: [recording.deviceModel, recording.deviceSoftware].filter(Boolean).join(" · ") || "not printed" },
    { k: "Scale", v: recording.paperSpeedMmS && recording.gainMmMv ? `${recording.paperSpeedMmS} mm/s, ${recording.gainMmMv} mm/mV` : "not printed" },
    { k: "PDF template", v: recording.pdfTemplateVersion ?? "not printed" },
  ];

  return (
    <main className={PAGE_MAIN}>
      <BackButton fallback="/journal/ecg" />
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{recording.result}</h1>
        <p className="text-sm text-muted">{formatRecordedAt(recording.recordedAt, recording.tz)}</p>
      </div>

      <div className="space-y-4">
        <EcgRecordingCard recording={recording} headingLevel={2} />

        <section className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
          <h2 className="mb-2 text-sm font-semibold text-ink">Where this came from</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {provenance.map((p) => (
              <div key={p.k} className="min-w-0">
                <dt className="text-[11px] uppercase tracking-wide text-muted">{p.k}</dt>
                <dd className="break-words text-sm text-ink">{p.v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[11px] text-muted">
            Read from the report as it was printed. The app prints Garmin&apos;s wording and adds nothing to it.
          </p>
        </section>

        <EcgDeleteButton id={recording.id} backTo="/journal/ecg" />
      </div>
    </main>
  );
}
