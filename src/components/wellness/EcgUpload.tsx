"use client";

/**
 * Import control for Garmin ECG reports.
 *
 * Choosing (or dropping) files IS the import: the PDFs go straight to
 * `importEcgReports`, which reads and saves them. There is no form and nothing
 * to confirm, because every value on the record is printed on the report — a
 * field to retype would only be a chance to get it wrong.
 *
 * Several files at once is the normal case: Garmin exports one PDF per
 * recording, and re-importing one already stored refreshes it rather than
 * duplicating it, so dropping a whole folder in is safe.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Check, RefreshCw, CircleAlert, Files } from "lucide-react";
import { importEcgReports, type EcgImportOutcome } from "@/app/actions/ecg";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 25;
const PILL = "inline-block whitespace-nowrap rounded-control px-1.5 py-0.5 text-[10px] font-medium";

const STATUS: Record<EcgImportOutcome["status"], { label: string; pill: string; Icon: typeof Check }> = {
  imported: { label: "imported", pill: "bg-ok/10 text-ok", Icon: Check },
  updated: { label: "refreshed", pill: "bg-ok/10 text-ok", Icon: RefreshCw },
  duplicate: { label: "already here", pill: "bg-line/[0.08] text-muted", Icon: Files },
  failed: { label: "not read", pill: "bg-danger/10 text-danger", Icon: CircleAlert },
};

export function EcgUpload({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<EcgImportOutcome[] | null>(null);

  async function send(files: File[]) {
    setError(null);
    setOutcomes(null);
    const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (pdfs.length === 0) {
      setError("Those are not PDF files. Export the ECG from Garmin Connect as a PDF.");
      return;
    }
    if (pdfs.length > MAX_FILES) {
      setError(`Import at most ${MAX_FILES} reports at a time.`);
      return;
    }
    const tooBig = pdfs.find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      setError(`${tooBig.name} is larger than 10 MB.`);
      return;
    }

    setBusy(true);
    const fd = new FormData();
    for (const f of pdfs) fd.append("files", f);
    fd.set("tz", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    let res;
    try {
      res = await importEcgReports(fd);
    } catch {
      setBusy(false);
      setError("The import did not finish. Please try again.");
      return;
    }
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not import these reports.");
      return;
    }
    setOutcomes(res.outcomes);
    // The section above this control is server-rendered; without a refresh a new
    // recording is saved but not on screen.
    if (res.outcomes.some((o) => o.status === "imported" || o.status === "updated")) router.refresh();
  }

  const imported = outcomes?.filter((o) => o.status === "imported" || o.status === "updated").length ?? 0;

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (busy) return;
          void send(Array.from(e.dataTransfer.files));
        }}
        className={`rounded-card border border-dashed p-4 text-center transition-colors ${
          dragging ? "border-accent bg-accent/[0.06]" : "border-line/25 bg-bg"
        }`}
      >
        {/* The real input is visually hidden but still the focusable control, so
            the styled button has to show ITS focus ring — `peer` carries the
            state across. Without this the control is invisible to a keyboard. */}
        <label htmlFor="ecg-report-files" className="block cursor-pointer">
          <input
            id="ecg-report-files"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            disabled={busy}
            className="peer sr-only"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length > 0) void send(files);
            }}
          />
          <span className="inline-flex items-center gap-2 rounded-control bg-accent px-3 py-2 text-sm font-medium text-onAccent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accentStrong peer-disabled:opacity-60">
            <Upload className="h-4 w-4" aria-hidden />
            {busy ? "Reading…" : "Import ECG reports"}
          </span>
        </label>
        <p className="mt-2 text-xs text-muted">
          {compact
            ? "PDFs from Garmin Connect. Drop several at once."
            : "Garmin Connect → the ECG recording → share as PDF. Drop the files here, or choose them. Everything on the report is read for you — there is nothing to type."}
        </p>
      </div>

      {/* The live regions are mounted whether or not they have anything to say.
          A region that appears together with its text is announced by some
          screen readers and missed by others; one that is already on the page
          when the text arrives is announced reliably. */}
      <p className="text-xs text-muted" role="status" aria-live="polite">
        {busy ? "Reading the reports…" : ""}
      </p>
      <p className="text-sm text-danger" role="alert">
        {error ?? ""}
      </p>

      <div role="status" aria-live="polite">
        {outcomes && outcomes.length > 0 && (
        <>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">
            {imported > 0 ? `${imported} of ${outcomes.length} added or refreshed` : `${outcomes.length} file(s) checked`}
          </p>
          <ul className="space-y-1 text-xs">
            {outcomes.map((o, i) => {
              const s = STATUS[o.status];
              return (
                <li key={`${o.file}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <s.Icon
                    className={`h-3.5 w-3.5 shrink-0 translate-y-0.5 ${o.status === "failed" ? "text-danger" : o.status === "duplicate" ? "text-muted" : "text-ok"}`}
                    aria-hidden
                  />
                  <span className="min-w-0 break-words font-medium text-ink">{o.file}</span>
                  <span className={`${PILL} ${s.pill}`}>{s.label}</span>
                  <span className="w-full text-muted sm:w-auto">{o.message}</span>
                </li>
              );
            })}
          </ul>
        </>
        )}
      </div>
    </div>
  );
}
