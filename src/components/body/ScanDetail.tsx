/**
 * Section 8 — per-scan detail, collapsed by default. Percentiles are printed
 * with the note "population position, not a target" and no colour. T-score is
 * hidden under 50 (Z is the relevant score there).
 */
import { FileText } from "lucide-react";
import type { Region } from "@/lib/body-comp-core";
import type { ScanWithDerived } from "@/lib/bodycomp-data";
import { BODY_COPY } from "@/lib/bodycomp-copy";
import { CARD, PILL, fmtDate, maskSerial, num, signed, tri } from "./format";
import { DeleteScanButton } from "./DeleteScanButton";

const REGION_ORDER: Region[] = ["l_arm", "r_arm", "trunk", "l_leg", "r_leg", "head", "android", "gynoid"];
const REGION_LABEL: Record<Region, string> = {
  l_arm: "Left arm", r_arm: "Right arm", trunk: "Trunk", l_leg: "Left leg", r_leg: "Right leg", head: "Head", android: "Android", gynoid: "Gynoid",
};

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted">{k}</dt>
      <dd className="tabular-nums text-ink">{v}</dd>
    </div>
  );
}

export function ScanDetail({ scan, open = false }: { scan: ScanWithDerived; open?: boolean }) {
  const regions = [...scan.regions].sort((a, b) => REGION_ORDER.indexOf(a.region) - REGION_ORDER.indexOf(b.region));
  const ix = scan.indices;
  const failing = scan.checks.filter((c) => !c.pass);
  const showT = scan.ageYears >= 50;

  return (
    <details className={`${CARD} mb-4`} open={open}>
      <summary className="flex cursor-pointer select-none flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <span>
          <span className="font-semibold text-ink">{fmtDate(scan.scannedAt)}</span>
          <span className="ml-2 whitespace-nowrap text-xs text-muted">{maskSerial(scan.deviceSerial)}{scan.softwareVersion ? ` · ${scan.softwareVersion}` : ""}</span>
        </span>
        <span className="text-xs tabular-nums text-muted">
          fat {(scan.totalFatG / 1000).toFixed(2)} kg · lean {(scan.totalLeanG / 1000).toFixed(2)} kg · {scan.pctFat.toFixed(1)} %
          {failing.length > 0 && <span className={`ml-2 ${PILL} bg-warn/10 text-warn`}>{failing.length} checksum{failing.length === 1 ? "" : "s"} off</span>}
        </span>
      </summary>

      <div className="mt-4 space-y-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Stat k="Total mass" v={`${(scan.totalMassG / 1000).toFixed(2)} kg`} />
          <Stat k="Fat" v={`${(scan.totalFatG / 1000).toFixed(2)} kg`} />
          <Stat k="Lean" v={`${(scan.totalLeanG / 1000).toFixed(2)} kg`} />
          <Stat k="BMC" v={`${(scan.totalBmcG / 1000).toFixed(3)} kg`} />
          <Stat k="Body fat" v={`${scan.pctFat.toFixed(1)} %`} />
          <Stat k="Clinic weight" v={scan.clinicWeightKg == null ? "—" : `${scan.clinicWeightKg.toFixed(1)} kg`} />
          <Stat k="Height" v={`${scan.heightCm.toFixed(1)} cm`} />
          <Stat k="Age · sex" v={`${scan.ageYears} · ${scan.sex}`} />
        </dl>

        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">Indices</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <Stat k="FFMI" v={`${ix.ffmi.toFixed(2)} kg/m²`} />
            <Stat k="LMI" v={`${ix.lmi.toFixed(2)} kg/m²`} />
            <Stat k="FMI" v={`${ix.fmi.toFixed(2)} kg/m²`} />
            <Stat k="ALMI" v={ix.almi == null ? "— (limb lean missing)" : `${ix.almi.toFixed(2)} kg/m²`} />
            <Stat k="% fat percentile (young-normal)" v={scan.pctFatYn == null ? "not printed" : `${scan.pctFatYn.toFixed(0)}`} />
            <Stat k="% fat percentile (age-matched)" v={scan.pctFatAm == null ? "not printed" : `${scan.pctFatAm.toFixed(0)}`} />
            <Stat k="Android / gynoid % fat" v={num(scan.ratios.androidGynoidPctFat, 2)} />
            <Stat k="Trunk / limb fat mass" v={num(scan.ratios.trunkLimbFatMass, 2)} />
          </dl>
          <p className="mt-1 text-[10px] text-muted">
            {BODY_COPY.percentileNote}. Percentiles are as printed against the scanner&apos;s reference population; the report names it.
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Stat k="VAT mass" v={scan.vatMassG == null ? "—" : `${scan.vatMassG.toFixed(0)} g`} />
          <Stat k="VAT volume" v={scan.vatVolumeCm3 == null ? "—" : `${scan.vatVolumeCm3.toFixed(0)} cm³`} />
          <Stat k="VAT area" v={scan.vatAreaCm2 == null ? "—" : `${scan.vatAreaCm2.toFixed(0)} cm²`} />
          <Stat k="Total BMD" v={scan.totalBmdGcm2 == null ? "—" : `${scan.totalBmdGcm2.toFixed(3)} g/cm²`} />
          <Stat k="BMD Z-score" v={scan.bmdZScore == null ? "—" : signed(scan.bmdZScore, 1)} />
          {showT && <Stat k="BMD T-score" v={scan.bmdTScore == null ? "—" : signed(scan.bmdTScore, 1)} />}
          <Stat k="Arm lean asymmetry (R − L)" v={scan.asymmetry.armsPct == null ? "—" : `${signed(scan.asymmetry.armsPct, 1)} %`} />
          <Stat k="Leg lean asymmetry (R − L)" v={scan.asymmetry.legsPct == null ? "—" : `${signed(scan.asymmetry.legsPct, 1)} %`} />
        </dl>

        {regions.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="py-1 pr-2 font-medium">Region</th>
                  <th className="py-1 pr-2 text-right font-medium">BMC g</th>
                  <th className="py-1 pr-2 text-right font-medium">Fat g</th>
                  <th className="py-1 pr-2 text-right font-medium">Lean g</th>
                  <th className="py-1 pr-2 text-right font-medium">Total g</th>
                  <th className="py-1 pr-2 text-right font-medium">% fat</th>
                  <th className="py-1 pr-2 text-right font-medium">YN %ile</th>
                  <th className="py-1 pr-2 text-right font-medium">AM %ile</th>
                  <th className="py-1 text-right font-medium">BMD g/cm²</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/10 tabular-nums">
                {regions.map((r) => (
                  <tr key={r.region}>
                    <td className="py-1 pr-2 text-ink">{REGION_LABEL[r.region]}</td>
                    <td className="py-1 pr-2 text-right">{num(r.bmcG, 0)}</td>
                    <td className="py-1 pr-2 text-right">{r.fatG.toFixed(0)}</td>
                    <td className="py-1 pr-2 text-right">{r.leanG.toFixed(0)}</td>
                    <td className="py-1 pr-2 text-right">{r.totalG.toFixed(0)}</td>
                    <td className="py-1 pr-2 text-right">{r.pctFat.toFixed(1)}</td>
                    <td className="py-1 pr-2 text-right">{num(r.pctFatYn, 0)}</td>
                    <td className="py-1 pr-2 text-right">{num(r.pctFatAm, 0)}</td>
                    <td className="py-1 text-right">{num(r.bmdGcm2, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">Checksums</p>
          <ul className="grid grid-cols-1 gap-x-4 text-xs sm:grid-cols-2">
            {scan.checks.map((c) => (
              <li key={c.name} className="flex items-center justify-between gap-2 py-0.5">
                <span className="text-ink">{c.name}</span>
                <span className="text-muted">{c.detail}</span>
                <span className={`${PILL} ${c.pass ? "bg-line/[0.08] text-muted" : "bg-warn/10 text-warn"}`}>{c.pass ? "pass" : "off"}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-muted">
          Prep: fasted {tri(scan.prep.fasted)}{scan.prep.fastingHours != null ? ` (${scan.prep.fastingHours} h)` : ""}, no caffeine {tri(scan.prep.noCaffeine)}, no training prior day {tri(scan.prep.noTrainingPriorDay)}, active travel {tri(scan.prep.activeTravel)}, hydrated and voided {tri(scan.prep.euhydratedVoided)}, illness-free 14 d {tri(scan.prep.illnessFree14d)}.
          {" "}Creatine: {scan.creatineStatus ?? "unknown"}. GH-secretagogue in the prior 14 days: {scan.ghs.onGhs ? "yes" : "no"}{scan.ghs.daysSinceLastDose != null ? ` (last dose ${scan.ghs.daysSinceLastDose} d before)` : ""}.
        </p>

        <div className="flex items-center justify-between gap-3">
          {scan.documentId ? (
            <a
              href={`/api/documents/${scan.documentId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-accentStrong underline-offset-2 hover:underline"
              title={BODY_COPY.reportAttached}
            >
              <FileText className="h-3.5 w-3.5" aria-hidden /> {BODY_COPY.reportLink}
            </a>
          ) : (
            <span />
          )}
          <DeleteScanButton id={scan.id} label={fmtDate(scan.scannedAt)} />
        </div>
      </div>
    </details>
  );
}
