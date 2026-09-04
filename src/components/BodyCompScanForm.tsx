"use client";

/**
 * DEXA scan entry — the manual-minimal path (5 totals + limb rows + VAT + bone)
 * with an optional expansion to the full eight-row regional grid. Every number
 * is sent as the string the user typed; the server action parses, validates,
 * encrypts and runs the checksums. Checksum failures are shown here as
 * warnings before the redirect — they never block the save.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { createBodyCompScan, type CreateScanInput, type RegionInput } from "@/app/actions/bodycomp";
import { LIMB_REGIONS, type ChecksumResult, type Region } from "@/lib/body-comp-core";
import { PrepChecklist, SCAN_PREP_ITEMS, type PrepValue } from "@/components/PrepChecklist";
import { BODY_COPY } from "@/lib/bodycomp-copy";

export interface ScanPrefill {
  sex: "male" | "female";
  ageYears: string;
  heightCm: string;
  clinicWeightKg: string;
}

const ALL_REGIONS: { key: Region; label: string; hasBone: boolean }[] = [
  { key: "l_arm", label: "L arm", hasBone: true },
  { key: "r_arm", label: "R arm", hasBone: true },
  { key: "trunk", label: "Trunk", hasBone: true },
  { key: "l_leg", label: "L leg", hasBone: true },
  { key: "r_leg", label: "R leg", hasBone: true },
  { key: "head", label: "Head", hasBone: true },
  { key: "android", label: "Android", hasBone: false },
  { key: "gynoid", label: "Gynoid", hasBone: false },
];
const LIMB_LABEL: Record<string, string> = { l_arm: "L arm", r_arm: "R arm", l_leg: "L leg", r_leg: "R leg" };

type RegionField = "bmcG" | "fatG" | "leanG" | "totalG" | "pctFat" | "pctFatYn" | "pctFatAm" | "bmdGcm2";
type RegionState = Record<RegionField, string>;
const blankRegion = (): RegionState => ({ bmcG: "", fatG: "", leanG: "", totalG: "", pctFat: "", pctFatYn: "", pctFatAm: "", bmdGcm2: "" });
const blankRegions = (): Record<Region, RegionState> =>
  Object.fromEntries(ALL_REGIONS.map((r) => [r.key, blankRegion()])) as Record<Region, RegionState>;

/** "YYYY-MM-DDTHH:MM" in the device's local time, for a datetime-local input. */
function toLocalInput(d: Date): string {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}
function nowLocalInput(): string {
  return toLocalInput(new Date());
}
/**
 * `initial.scannedAt` (ISO) → datetime-local value. Manual entry starts at now;
 * a PDF prefill whose printed date could not be read starts BLANK — the "from
 * PDF" badge must never sit over a silently-substituted current time.
 */
function initialLocalInput(iso: string | undefined, fromPdf: boolean): string {
  if (!iso) return fromPdf ? "" : nowLocalInput();
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? (fromPdf ? "" : nowLocalInput()) : toLocalInput(d);
}

/** Region rows from `initial` laid over the blank grid (missing cells stay ""). */
function regionsFromInitial(rows: RegionInput[] | undefined): Record<Region, RegionState> {
  const out = blankRegions();
  for (const r of rows ?? []) {
    if (!(r.region in out)) continue;
    out[r.region] = {
      bmcG: r.bmcG ?? "", fatG: r.fatG ?? "", leanG: r.leanG ?? "", totalG: r.totalG ?? "", pctFat: r.pctFat ?? "",
      pctFatYn: r.pctFatYn ?? "", pctFatAm: r.pctFatAm ?? "", bmdGcm2: r.bmdGcm2 ?? "",
    };
  }
  return out;
}

function deviceTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const REGION_ROW_FIELDS: { key: RegionField; label: string }[] = [
  { key: "bmcG", label: "BMC g" },
  { key: "fatG", label: "Fat g" },
  { key: "leanG", label: "Lean g" },
  { key: "totalG", label: "Total g" },
  { key: "pctFat", label: "% fat" },
  { key: "pctFatYn", label: "YN %ile" },
  { key: "pctFatAm", label: "AM %ile" },
  { key: "bmdGcm2", label: "BMD g/cm²" },
];

export interface BodyCompScanFormProps {
  /** Subject block of the most recent scan (used when `initial` has no value for a field). */
  prefill: ScanPrefill | null;
  /** Values read from an uploaded report; every provided field is filled and marked "from PDF". */
  initial?: Partial<CreateScanInput>;
  /** Uploaded `Document.id` to link on save (also rendered as a hidden field). */
  documentId?: string;
}

export function BodyCompScanForm({ prefill, initial, documentId }: BodyCompScanFormProps) {
  const router = useRouter();
  const inputCls = "rounded-control border border-line/15 bg-bg px-3 py-2 text-sm";
  const numCls = `mt-1 w-full tabular-nums ${inputCls}`;
  const fromPdf = initial != null;
  const init = (k: keyof CreateScanInput, fallback = ""): string => {
    const v = initial?.[k];
    return typeof v === "string" ? v : fallback;
  };

  const [scannedAtLocal, setScannedAtLocal] = useState(() => initialLocalInput(initial?.scannedAt, fromPdf));
  const pdfDateUnread = fromPdf && !initial?.scannedAt;
  const [f, setF] = useState<Record<string, string>>(() => ({
    deviceMake: init("deviceMake"), deviceModel: init("deviceModel"), deviceSerial: init("deviceSerial"), softwareVersion: init("softwareVersion"),
    scanMode: init("scanMode"), facility: init("facility"), referencePopulation: init("referencePopulation"),
    ageYears: init("ageYears", prefill?.ageYears ?? ""), heightCm: init("heightCm", prefill?.heightCm ?? ""), clinicWeightKg: init("clinicWeightKg", prefill?.clinicWeightKg ?? ""),
    totalFatG: init("totalFatG"), totalLeanG: init("totalLeanG"), totalBmcG: init("totalBmcG"), totalMassG: init("totalMassG"), pctFat: init("pctFat"),
    pctFatYn: init("pctFatYn"), pctFatAm: init("pctFatAm"),
    vatMassG: init("vatMassG"), vatVolumeCm3: init("vatVolumeCm3"), vatAreaCm2: init("vatAreaCm2"),
    totalBmdGcm2: init("totalBmdGcm2"), bmdTScore: init("bmdTScore"), bmdZScore: init("bmdZScore"), bmdCvPct: init("bmdCvPct"),
    fmiYn: init("fmiYn"), fmiAm: init("fmiAm"), lmiYn: init("lmiYn"), lmiAm: init("lmiAm"), almiYn: init("almiYn"), almiAm: init("almiAm"),
    notes: init("notes"),
  }));
  const [sex, setSex] = useState<"male" | "female">(initial?.sex ?? prefill?.sex ?? "male");
  const [creatineStatus, setCreatineStatus] = useState<"" | "stable" | "started" | "stopped" | "none">(initial?.creatineStatus ?? "");
  const [carbPattern48h, setCarbPattern48h] = useState<"" | "normal" | "loaded" | "depleted">(initial?.carbPattern48h ?? "");
  const [prep, setPrep] = useState<PrepValue>({});
  const [prepNumbers, setPrepNumbers] = useState<Record<string, string>>({});
  const [regions, setRegions] = useState<Record<Region, RegionState>>(() => regionsFromInitial(initial?.regions));
  const [fullGrid, setFullGrid] = useState((initial?.regions?.length ?? 0) === ALL_REGIONS.length);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<ChecksumResult[] | null>(null);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));
  const setRegion = (r: Region, k: RegionField, v: string) =>
    setRegions((cur) => ({ ...cur, [r]: { ...cur[r], [k]: v } }));

  const opt = (v: string): string | undefined => (v.trim() ? v.trim() : undefined);

  /** Region rows to send: none, the four limbs, or all eight — the server validates the shape. */
  function buildRegions(): RegionInput[] {
    const keys: Region[] = fullGrid ? ALL_REGIONS.map((r) => r.key) : LIMB_REGIONS;
    const touched = keys.some((k) => Object.values(regions[k]).some((v) => v.trim() !== ""));
    if (!touched) return [];
    return keys.map((k) => {
      const r = regions[k];
      return {
        region: k,
        bmcG: opt(r.bmcG), fatG: r.fatG.trim(), leanG: r.leanG.trim(), totalG: r.totalG.trim(), pctFat: r.pctFat.trim(),
        pctFatYn: opt(r.pctFatYn), pctFatAm: opt(r.pctFatAm), bmdGcm2: opt(r.bmdGcm2),
      };
    });
  }

  async function onSubmit() {
    setBusy(true);
    setError(null);
    setChecks(null);

    const at = new Date(scannedAtLocal);
    if (Number.isNaN(at.getTime())) {
      setBusy(false);
      setError("Enter the scan date and time.");
      return;
    }

    const input: CreateScanInput = {
      scannedAt: at.toISOString(),
      tz: deviceTz(),
      deviceMake: opt(f.deviceMake), deviceModel: opt(f.deviceModel), deviceSerial: opt(f.deviceSerial), softwareVersion: opt(f.softwareVersion),
      scanMode: opt(f.scanMode), facility: opt(f.facility), referencePopulation: opt(f.referencePopulation),
      sex, ageYears: f.ageYears.trim(), heightCm: f.heightCm.trim(), clinicWeightKg: opt(f.clinicWeightKg),
      totalFatG: f.totalFatG.trim(), totalLeanG: f.totalLeanG.trim(), totalBmcG: f.totalBmcG.trim(), totalMassG: f.totalMassG.trim(), pctFat: f.pctFat.trim(),
      pctFatYn: opt(f.pctFatYn), pctFatAm: opt(f.pctFatAm),
      vatMassG: opt(f.vatMassG), vatVolumeCm3: opt(f.vatVolumeCm3), vatAreaCm2: opt(f.vatAreaCm2),
      totalBmdGcm2: opt(f.totalBmdGcm2), bmdTScore: opt(f.bmdTScore), bmdZScore: opt(f.bmdZScore), bmdCvPct: opt(f.bmdCvPct),
      fmiYn: opt(f.fmiYn), fmiAm: opt(f.fmiAm), lmiYn: opt(f.lmiYn), lmiAm: opt(f.lmiAm), almiYn: opt(f.almiYn), almiAm: opt(f.almiAm),
      prep: {
        fasted: prep.fasted ?? null,
        fastingHours: prep.fasted === true ? opt(prepNumbers.fastingHours ?? "") : undefined,
        noCaffeine: prep.noCaffeine ?? null,
        noTrainingPriorDay: prep.noTrainingPriorDay ?? null,
        activeTravel: prep.activeTravel ?? null,
        euhydratedVoided: prep.euhydratedVoided ?? null,
        illnessFree14d: prep.illnessFree14d ?? null,
      },
      creatineStatus: creatineStatus || undefined,
      carbPattern48h: carbPattern48h || undefined,
      regions: buildRegions(),
      notes: opt(f.notes),
      documentId: documentId || undefined,
    };

    const res = await createBodyCompScan(input);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not save the scan.");
      return;
    }
    const failing = (res.checks ?? []).filter((c) => !c.pass);
    if (failing.length > 0) {
      // Show the pass/fail list; the user continues to /body when ready.
      setChecks(res.checks ?? []);
      router.refresh();
      return;
    }
    router.push("/body");
    router.refresh();
  }

  const field = (k: string, label: string, opts: { required?: boolean; placeholder?: string; text?: boolean } = {}) => (
    <label htmlFor={`scan-${k}`} className="block text-xs text-muted">
      {label}{opts.required && <span className="text-danger"> *</span>}
      <input
        id={`scan-${k}`}
        inputMode={opts.text ? "text" : "decimal"}
        value={f[k]}
        onChange={set(k)}
        placeholder={opts.placeholder}
        className={opts.text ? `mt-1 w-full ${inputCls}` : numCls}
      />
    </label>
  );

  const pdfBadge = (
    <span className="ml-2 inline-block whitespace-nowrap rounded-control bg-accent/10 px-1.5 py-0.5 align-middle text-[10px] font-medium text-accentStrong">
      {BODY_COPY.fromPdf}
    </span>
  );

  /** `pdf` marks a section whose fields the uploaded report filled. */
  const section = (title: string, sub: string | null, body: React.ReactNode, pdf = false) => (
    <section className="space-y-2">
      <div>
        <p className="text-sm font-medium text-ink">{title}{pdf && fromPdf && pdfBadge}</p>
        {sub && <p className="text-xs text-muted">{sub}</p>}
      </div>
      {body}
    </section>
  );

  if (checks) {
    const failing = checks.filter((c) => !c.pass);
    return (
      <div className="space-y-3 rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
        <p className="rounded-control bg-ok/10 px-3 py-2 text-sm font-medium text-ok">Scan saved ✓</p>
        <p className="text-sm text-ink">
          {failing.length} of {checks.length} checksum{checks.length === 1 ? "" : "s"} did not match the printed totals. The scan is saved as entered — re-check the report against these rows.
        </p>
        <ul className="divide-y divide-line/10 text-sm">
          {checks.map((c) => (
            <li key={c.name} className="flex items-center justify-between gap-2 py-2">
              <span className="font-mono text-xs text-ink">{c.name}</span>
              <span className="text-xs text-muted tabular-nums">{c.detail}</span>
              <span className={`rounded-control px-1.5 py-0.5 text-[10px] font-medium ${c.pass ? "bg-ok/10 text-ok" : "bg-warn/15 text-warn"}`}>
                {c.pass ? "pass" : "fail"}
              </span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => router.push("/body")}
          className="w-full rounded-control bg-accent px-4 py-3 font-medium text-onAccent"
        >
          Continue to Body
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
      {documentId && <input type="hidden" name="documentId" value={documentId} readOnly />}
      {documentId && (
        <p className="rounded-control bg-bg/40 px-3 py-2 text-xs text-muted ring-1 ring-line/10">
          {BODY_COPY.reportAttached}{fromPdf ? " — values below were read from it; check each against the printed page." : " — enter the values from the printed page."}
        </p>
      )}
      {section("Visit", "Same machine, software and technologist as the last scan keeps the comparison honest.", (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label htmlFor="scan-scannedAt" className="block text-xs text-muted sm:col-span-2">
            Scan date and time<span className="text-danger"> *</span>
            <input id="scan-scannedAt" type="datetime-local" value={scannedAtLocal} onChange={(e) => setScannedAtLocal(e.target.value)} aria-describedby={pdfDateUnread ? "scan-scannedAt-hint" : undefined} className={`mt-1 w-full ${inputCls}`} />
            {pdfDateUnread && <span id="scan-scannedAt-hint" className="mt-1 block text-warn">The printed scan date could not be read from the report — enter it from the printed page.</span>}
          </label>
          {field("deviceMake", "Device make", { text: true, placeholder: "e.g. Hologic" })}
          {field("deviceModel", "Device model", { text: true, placeholder: "e.g. Horizon A" })}
          {field("deviceSerial", "Device serial", { text: true })}
          {field("softwareVersion", "Software version", { text: true })}
          {field("scanMode", "Scan mode", { text: true, placeholder: "e.g. Whole body" })}
          {field("facility", "Facility", { text: true })}
          {field("referencePopulation", "Reference population", { text: true, placeholder: "as printed on the report" })}
        </div>
      ), true)}

      {section("Subject", fromPdf ? "As printed on the report." : prefill ? "Prefilled from your most recent scan — update anything that changed." : null, (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label htmlFor="scan-sex" className="block text-xs text-muted">
            Sex<span className="text-danger"> *</span>
            <select id="scan-sex" value={sex} onChange={(e) => setSex(e.target.value as "male" | "female")} className={`mt-1 w-full ${inputCls}`}>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </label>
          {field("ageYears", "Age (years)", { required: true })}
          {field("heightCm", "Height (cm)", { required: true })}
          {field("clinicWeightKg", "Clinic weight (kg)")}
        </div>
      ), true)}

      {section("Totals", "Whole-body row of the report.", (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {field("totalFatG", "Fat (g)", { required: true })}
          {field("totalLeanG", "Lean (g)", { required: true })}
          {field("totalBmcG", "BMC (g)", { required: true })}
          {field("totalMassG", "Total mass (g)", { required: true })}
          {field("pctFat", "% fat", { required: true })}
        </div>
      ), true)}

      {!fullGrid &&
        section("Limb rows", "Lean per limb is what ALMI needs; the server stores each limb row whole (fat, lean, total, % fat). Leave all four blank to skip.", (
          <div className="space-y-2">
            {LIMB_REGIONS.map((k) => (
              <div key={k} className="rounded-control bg-bg/40 p-2 ring-1 ring-line/10">
                <p className="mb-1 text-xs font-medium text-ink">{LIMB_LABEL[k]}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <label htmlFor={`scan-limb-${k}-leanG`} className="block text-xs text-muted">
                    Lean g <span className="text-muted/70">(for ALMI)</span>
                    <input id={`scan-limb-${k}-leanG`} inputMode="decimal" value={regions[k].leanG} onChange={(e) => setRegion(k, "leanG", e.target.value)} className={numCls} />
                  </label>
                  <label htmlFor={`scan-limb-${k}-fatG`} className="block text-xs text-muted">
                    Fat g
                    <input id={`scan-limb-${k}-fatG`} inputMode="decimal" value={regions[k].fatG} onChange={(e) => setRegion(k, "fatG", e.target.value)} className={numCls} />
                  </label>
                  <label htmlFor={`scan-limb-${k}-totalG`} className="block text-xs text-muted">
                    Total g
                    <input id={`scan-limb-${k}-totalG`} inputMode="decimal" value={regions[k].totalG} onChange={(e) => setRegion(k, "totalG", e.target.value)} className={numCls} />
                  </label>
                  <label htmlFor={`scan-limb-${k}-pctFat`} className="block text-xs text-muted">
                    % fat
                    <input id={`scan-limb-${k}-pctFat`} inputMode="decimal" value={regions[k].pctFat} onChange={(e) => setRegion(k, "pctFat", e.target.value)} className={numCls} />
                  </label>
                </div>
              </div>
            ))}
          </div>
        ))}

      {section("VAT", "Visceral adipose tissue, as printed (any of the three units).", (
        <div className="grid grid-cols-3 gap-3">
          {field("vatMassG", "Mass (g)")}
          {field("vatVolumeCm3", "Volume (cm³)")}
          {field("vatAreaCm2", "Area (cm²)")}
        </div>
      ), true)}

      {section("Bone", "Whole-body BMD and its scores. CV % only if the site prints its own.", (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {field("totalBmdGcm2", "Total BMD (g/cm²)")}
          {field("bmdTScore", "T-score")}
          {field("bmdZScore", "Z-score")}
          {field("bmdCvPct", "Site CV %")}
        </div>
      ), true)}

      <details className="rounded-control bg-bg/40 p-2 ring-1 ring-line/10" open={fromPdf || undefined}>
        <summary className="cursor-pointer text-sm font-medium text-ink">Percentiles (optional){fromPdf && pdfBadge}</summary>
        <p className="mb-2 text-xs text-muted">Population position as printed — not a target.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {field("pctFatYn", "% fat YN")}
          {field("pctFatAm", "% fat AM")}
          {field("fmiYn", "FMI YN")}
          {field("fmiAm", "FMI AM")}
          {field("lmiYn", "LMI YN")}
          {field("lmiAm", "LMI AM")}
          {field("almiYn", "ALMI YN")}
          {field("almiAm", "ALMI AM")}
        </div>
      </details>

      <div className="flex items-center justify-between gap-3 rounded-control bg-bg/40 p-2 ring-1 ring-line/10">
        <div>
          <p className="text-sm font-medium text-ink">Full regional table{fromPdf && fullGrid && pdfBadge}</p>
          <p className="text-xs text-muted">All eight rows of the report (replaces the limb rows above).</p>
        </div>
        <button
          type="button"
          aria-pressed={fullGrid}
          aria-label="Full regional table"
          onClick={() => setFullGrid((v) => !v)}
          className={`min-h-[40px] min-w-[44px] shrink-0 rounded-control px-3 text-xs font-medium ring-1 transition-colors ${
            fullGrid ? "bg-accent text-onAccent ring-transparent" : "bg-bg text-ink ring-line/15 hover:ring-line/30"
          }`}
        >
          {fullGrid ? "On" : "Off"}
        </button>
      </div>

      {fullGrid && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-2 font-medium">Region</th>
                {REGION_ROW_FIELDS.map((c) => (
                  <th key={c.key} className="py-1 pr-2 font-medium">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_REGIONS.map((r) => (
                <tr key={r.key} className="border-t border-line/10">
                  <td className="py-1 pr-2 font-medium text-ink">{r.label}</td>
                  {REGION_ROW_FIELDS.map((c) => {
                    const hidden = !r.hasBone && (c.key === "bmcG" || c.key === "bmdGcm2");
                    return (
                      <td key={c.key} className="py-1 pr-2">
                        {hidden ? (
                          <span className="text-muted/50">—</span>
                        ) : (
                          <input
                            inputMode="decimal"
                            aria-label={`${r.label} ${c.label}`}
                            value={regions[r.key][c.key]}
                            onChange={(e) => setRegion(r.key, c.key, e.target.value)}
                            className={`w-20 tabular-nums ${inputCls} px-2 py-1`}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {section("Preparation", "Answered from the pre-visit checklist, not memory. Unknown is a valid answer.", (
        <PrepChecklist value={prep} onChange={setPrep} items={SCAN_PREP_ITEMS} numbers={prepNumbers} onNumbersChange={setPrepNumbers} idPrefix="scan-prep" />
      ))}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label htmlFor="scan-creatineStatus" className="block text-xs text-muted">
          Creatine status
          <select id="scan-creatineStatus" value={creatineStatus} onChange={(e) => setCreatineStatus(e.target.value as typeof creatineStatus)} className={`mt-1 w-full ${inputCls}`}>
            <option value="">Not recorded</option>
            <option value="none">Not taking</option>
            <option value="stable">Stable (unchanged ≥ 4 weeks)</option>
            <option value="started">Started recently</option>
            <option value="stopped">Stopped recently</option>
          </select>
        </label>
        <label htmlFor="scan-carbPattern48h" className="block text-xs text-muted">
          Carbohydrate, last 48 h
          <select id="scan-carbPattern48h" value={carbPattern48h} onChange={(e) => setCarbPattern48h(e.target.value as typeof carbPattern48h)} className={`mt-1 w-full ${inputCls}`}>
            <option value="">Not recorded</option>
            <option value="normal">Normal</option>
            <option value="loaded">Loaded</option>
            <option value="depleted">Depleted</option>
          </select>
        </label>
      </div>

      <label htmlFor="scan-notes" className="block text-sm">
        Notes
        <input id="scan-notes" value={f.notes} onChange={set("notes")} placeholder="Optional, encrypted" className={`mt-1 w-full ${inputCls}`} />
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="button"
        onClick={onSubmit}
        disabled={busy}
        className="w-full rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40"
      >
        <Save className="mr-1.5 inline h-4 w-4 align-[-0.125em]" aria-hidden />{busy ? "Saving…" : "Save DEXA scan"}
      </button>
    </div>
  );
}
