"use client";

/**
 * DEXA report upload → parsed preview → "Use these values" / "Enter manually".
 *
 * The PDF goes to `uploadDexaReport`, which stores it, creates the `Document`
 * row and returns the Hologic parse. Nothing is saved as a scan here: the parent
 * (`DexaEntry`) passes the parsed values into `BodyCompScanForm` as `initial`
 * and the document id rides along on the eventual save. A failed parse keeps
 * the PDF attached and the form empty.
 */

import { useEffect, useRef, useState } from "react";
import { Upload, FileText, Trash2 } from "lucide-react";
import { uploadDexaReport, discardDocument } from "@/app/actions/documents";
import type { ParseResult } from "@/lib/dexa-parse-core";
import type { CreateScanInput } from "@/app/actions/bodycomp";
import { parsedToScanInitial } from "@/lib/dexa-prefill";
import { BODY_COPY } from "@/lib/bodycomp-copy";
import { BodyCompScanForm, type ScanPrefill } from "@/components/BodyCompScanForm";

const MAX_BYTES = 10 * 1024 * 1024;
const PILL = "inline-block whitespace-nowrap rounded-control px-1.5 py-0.5 text-[10px] font-medium";
const REGION_LABEL: Record<string, string> = {
  l_arm: "L arm", r_arm: "R arm", trunk: "Trunk", l_leg: "L leg", r_leg: "R leg", head: "Head", android: "Android", gynoid: "Gynoid",
};

function maskSerial(serial: string | null): string {
  if (!serial) return "serial not printed";
  return serial.length <= 4 ? "serial ····" : `serial ····${serial.slice(-4)}`;
}

interface Uploaded { documentId: string; parse: ParseResult }

export interface DexaUploadCardProps {
  onPrefill: (documentId: string, initial: Partial<CreateScanInput>) => void;
  onManual: (documentId: string) => void;
  onDiscard: () => void;
}

export function DexaUploadCard({ onPrefill, onManual, onDiscard }: DexaUploadCardProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);
  const [choice, setChoice] = useState<"values" | "manual" | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) {
      setError("The file is larger than 10 MB.");
      e.target.value = "";
      return;
    }
    setBusy(true);
    const fd = new FormData();
    fd.set("file", file);
    const res = await uploadDexaReport(fd);
    setBusy(false);
    e.target.value = "";
    if (!res.ok || !res.documentId || !res.parse) {
      setError(res.error ?? "Could not upload the report.");
      return;
    }
    setUploaded({ documentId: res.documentId, parse: res.parse });
    setChoice(null);
  }

  async function discard() {
    if (!uploaded) return;
    setBusy(true);
    const res = await discardDocument(uploaded.documentId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not discard the report.");
      return;
    }
    setUploaded(null);
    setChoice(null);
    setError(null);
    onDiscard();
  }

  const inputCls = "rounded-control border border-line/15 bg-bg px-3 py-2 text-sm";

  if (!uploaded) {
    return (
      <div className="space-y-3 rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
        <div>
          <p className="text-sm font-medium text-ink">Report PDF</p>
          <p className="text-xs text-muted">{BODY_COPY.uploadIntro}</p>
        </div>
        <label htmlFor="dexa-report-file" className="block text-xs text-muted">
          Hologic report (PDF, up to 10 MB)
          <input
            id="dexa-report-file"
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={onFile}
            disabled={busy}
            className={`mt-1 block w-full text-sm file:mr-3 file:rounded-control file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-onAccent ${inputCls}`}
          />
        </label>
        {busy && (
          <p className="text-xs text-muted" role="status">
            <Upload className="mr-1 inline h-3.5 w-3.5 align-[-0.125em]" aria-hidden />Reading the report…
          </p>
        )}
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      </div>
    );
  }

  const { parse } = uploaded;
  const scan = parse.scan;
  const failing = parse.checks.filter((c) => !c.pass);
  const pct = Math.round(parse.confidence * 100);
  const panelCls = parse.ok ? "ring-ok/30" : "ring-danger/40";

  return (
    <div className={`space-y-4 rounded-card bg-surface p-4 shadow-sm ring-1 ${panelCls}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">
            <FileText className="mr-1 inline h-4 w-4 align-[-0.125em]" aria-hidden />
            {parse.ok ? "Report read" : "Report attached — not fully read"}
            <span className={`ml-2 ${PILL} ${parse.ok ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"}`}>{pct} % confidence</span>
            {choice && <span className={`ml-2 ${PILL} bg-line/[0.08] text-muted`}>{choice === "values" ? "values in the form" : "manual entry"}</span>}
          </p>
          <p className={`text-xs ${parse.ok ? "text-muted" : "text-danger"}`}>{parse.ok ? BODY_COPY.uploadPass : BODY_COPY.uploadFail}</p>
          <p className="text-[10px] text-muted">{BODY_COPY.uploadConfidence}.</p>
        </div>
        <button
          type="button"
          onClick={discard}
          disabled={busy}
          aria-label="Discard the uploaded report"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-danger disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden /> Discard
        </button>
      </div>

      {parse.missing.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">Not found in the text layer</p>
          <ul className="flex flex-wrap gap-1">
            {parse.missing.map((m) => (
              <li key={m} className={`${PILL} ${parse.ok ? "bg-line/[0.08] text-muted" : "bg-danger/10 text-danger"}`}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {parse.checks.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">
            Checksums {failing.length > 0 ? `— ${failing.length} of ${parse.checks.length} off` : "— all matched"}
          </p>
          <ul className="grid grid-cols-1 gap-x-4 text-xs sm:grid-cols-2">
            {parse.checks.map((c) => (
              <li key={c.name} className="flex items-center justify-between gap-2 py-0.5">
                <span className="text-ink">{c.name}</span>
                <span className="text-muted tabular-nums">{c.detail}</span>
                <span className={`${PILL} ${c.pass ? "bg-line/[0.08] text-muted" : "bg-warn/10 text-warn"}`}>{c.pass ? "pass" : "off"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {scan && (
        <div className="space-y-2 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <div><dt className="text-[11px] uppercase tracking-wide text-muted">Scan date</dt><dd className="text-ink">{scan.header.scanDate ?? scan.header.scanDateRaw ?? "not printed"}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-wide text-muted">Scanner</dt><dd className="text-ink">{scan.header.deviceModel ?? "—"} · {maskSerial(scan.header.deviceSerial)}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-wide text-muted">Software</dt><dd className="text-ink">{scan.header.softwareVersion ?? "—"}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-wide text-muted">Subject</dt><dd className="text-ink">{scan.header.sex} · {scan.header.ageYears} y · {scan.header.heightCm} cm{scan.header.clinicWeightKg != null ? ` · ${scan.header.clinicWeightKg} kg` : ""}</dd></div>
          </dl>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums sm:grid-cols-5">
            <div><dt className="text-[11px] uppercase tracking-wide text-muted">Fat</dt><dd className="text-ink">{scan.totals.totalFatG} g</dd></div>
            <div><dt className="text-[11px] uppercase tracking-wide text-muted">Lean</dt><dd className="text-ink">{scan.totals.totalLeanG} g</dd></div>
            <div><dt className="text-[11px] uppercase tracking-wide text-muted">BMC</dt><dd className="text-ink">{scan.totals.totalBmcG} g</dd></div>
            <div><dt className="text-[11px] uppercase tracking-wide text-muted">Total</dt><dd className="text-ink">{scan.totals.totalMassG} g</dd></div>
            <div><dt className="text-[11px] uppercase tracking-wide text-muted">% fat</dt><dd className="text-ink">{scan.totals.pctFat} %</dd></div>
          </dl>
          {scan.regions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-xs">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                    <th className="py-1 pr-2 font-medium">Region</th>
                    <th className="py-1 pr-2 text-right font-medium">Fat g</th>
                    <th className="py-1 pr-2 text-right font-medium">Lean g</th>
                    <th className="py-1 pr-2 text-right font-medium">Total g</th>
                    <th className="py-1 text-right font-medium">% fat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/10 tabular-nums">
                  {scan.regions.map((r) => (
                    <tr key={r.region}>
                      <td className="py-1 pr-2 text-ink">{REGION_LABEL[r.region] ?? r.region}</td>
                      <td className="py-1 pr-2 text-right">{r.fatG}</td>
                      <td className="py-1 pr-2 text-right">{r.leanG}</td>
                      <td className="py-1 pr-2 text-right">{r.totalG}</td>
                      <td className="py-1 text-right">{r.pctFat}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={!scan || busy}
          onClick={() => {
            if (!scan) return;
            setChoice("values");
            onPrefill(uploaded.documentId, parsedToScanInitial(scan));
          }}
          className="flex-1 rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-onAccent disabled:opacity-40"
        >
          Use these values
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setChoice("manual");
            onManual(uploaded.documentId);
          }}
          className="flex-1 rounded-control bg-bg px-4 py-2.5 text-sm font-medium text-ink ring-1 ring-line/15 hover:ring-line/30 disabled:opacity-40"
        >
          Enter manually
        </button>
      </div>
    </div>
  );
}

/**
 * Upload card + scan form for `/body/new`. "Use these values" remounts the form
 * with the parsed values as `initial` (full regional grid on, "from PDF" badges);
 * "Enter manually" keeps the document attached but clears any parsed values
 * (a blank form — the pill says manual entry, so no "from PDF" badge remains).
 *
 * Leaving the page with a report attached but nothing saved discards it: the
 * upload is never confirmed, so nothing should keep it. A saved scan already
 * references its document and the discard is refused server-side (no-op).
 */
export function DexaEntry({ prefill }: { prefill: ScanPrefill | null }) {
  const [documentId, setDocumentId] = useState<string | undefined>(undefined);
  const [initial, setInitial] = useState<Partial<CreateScanInput> | undefined>(undefined);
  const [formKey, setFormKey] = useState(0);
  const attachedRef = useRef<string | undefined>(undefined);
  useEffect(() => { attachedRef.current = documentId; }, [documentId]);
  useEffect(() => () => { const id = attachedRef.current; if (id) void discardDocument(id).catch(() => undefined); }, []);

  const clearParsed = () => {
    if (initial) {
      setInitial(undefined);
      setFormKey((k) => k + 1);
    }
  };

  return (
    <div className="space-y-4">
      <DexaUploadCard
        onPrefill={(id, values) => {
          setDocumentId(id);
          setInitial(values);
          setFormKey((k) => k + 1);
        }}
        onManual={(id) => {
          setDocumentId(id);
          clearParsed();
        }}
        onDiscard={() => {
          setDocumentId(undefined);
          clearParsed();
        }}
      />
      <BodyCompScanForm key={formKey} prefill={prefill} initial={initial} documentId={documentId} />
    </div>
  );
}
