/**
 * Section 1 — scan series with LSC ribbons, as SVG small multiples.
 *
 * Each scan is a point. From each point a horizontal ribbon of ± technical LSC
 * (tighter, darker) and ± practical LSC (wider, fainter) extends to the next
 * scan — or 112 days forward for the latest. Bands render BEFORE points in DOM
 * order. No line joins points until n ≥ 3, so two points never read as a slope.
 *
 * Bands are recomputed here from the pure core library on each scan's own
 * value (the data layer only carries bands for the latest scan).
 */
import {
  almLsc, bmdLsc, fatLsc, leanLsc, pctFatLsc, rmrLsc, vatLsc,
  type LscBand, type Precision,
} from "@/lib/body-comp-core";
import type { BodyDashboardData, LifeEventValues, MetabolicTestValues, ScanWithDerived } from "@/lib/bodycomp-data";
import { BODY_COPY } from "@/lib/bodycomp-copy";
import { CARD, fmtDateShort, precisionLabel } from "./format";

const DAY = 86_400_000;
const FORWARD_DAYS = 112;
const W = 600;
const H = 130;
const PAD = { top: 12, right: 12, bottom: 22, left: 40 };

interface Pt { t: number; v: number; band: LscBand | null }
interface Bg { t: number; v: number }
interface Panel {
  key: string;
  title: string;
  unit: string;
  digits: number;
  points: Pt[];
  /** Faint dashed background series (calibrated BIA %fat or cleaned scale weight). */
  bg: Bg[];
  /**
   * True when the background is the same quantity as the points (scale weight
   * beside clinic weight) and may size the axis. False for the BIA estimate: it is
   * never on the DXA axis — the axis is sized from DXA points and bands only and
   * the dashed path is clipped to the plot area (spec §3).
   */
  bgSharesAxis: boolean;
  bgLabel: string | null;
  excludedCount: number;
}

interface Props {
  scans: ScanWithDerived[];
  tests: MetabolicTestValues[];
  precision: Precision;
  bia: BodyDashboardData["bia"];
  /** Calibrated BIA background is only drawn once a comparator scan exists (n ≥ 2). */
  showBia: boolean;
  /** Illness / travel / other windows — one faint shaded rect per event on every panel, drawn before the bands. */
  lifeEvents?: LifeEventValues[];
}

/** Tint per kind: illness = warn, travel = accent, other = line. Faint on purpose — a window is context, not a signal. */
const EVENT_FILL: Record<LifeEventValues["kind"], string> = {
  illness: "rgb(var(--warn))",
  travel: "rgb(var(--accent))",
  other: "rgb(var(--line))",
};
interface Shade { key: string; kind: LifeEventValues["kind"]; t0: number; t1: number; title: string }
/** Event day range → [start of startDay, end of endDay) in ms; inclusive end day. */
function shadesFor(events: LifeEventValues[]): Shade[] {
  return events.map((e) => ({ key: e.id, kind: e.kind, t0: dayT(e.startDay), t1: dayT(e.endDay) + DAY, title: `${e.kind}${e.label ? `: ${e.label}` : ""} ${e.startDay} → ${e.endDay}` }));
}

const dayT = (day: string) => Date.parse(day);

function buildPanels({ scans, tests, precision, bia, showBia }: Props): Panel[] {
  const p = precision;
  const at = (s: ScanWithDerived) => s.scannedAt.getTime();
  const pick = (title: string, key: string, unit: string, digits: number, get: (s: ScanWithDerived) => { v: number | null; band: LscBand | null }): Panel => ({
    key, title, unit, digits, bg: [], bgSharesAxis: false, bgLabel: null, excludedCount: 0,
    points: scans.flatMap((s) => { const r = get(s); return r.v == null ? [] : [{ t: at(s), v: r.v, band: r.band }]; }),
  });

  const weightBg: Bg[] = bia ? bia.weight.kept.map((r) => ({ t: dayT(r.day), v: r.weightKg })) : [];
  const biaBg: Bg[] = showBia && bia ? bia.calibrated.flatMap((c) => (c.calibratedPct == null ? [] : [{ t: dayT(c.day), v: c.calibratedPct }])) : [];
  // n = 0 only: the raw scale %fat, labelled uncalibrated bioimpedance.
  const rawBiaBg: Bg[] = scans.length === 0 && bia ? bia.raw.map((r) => ({ t: dayT(r.day), v: r.bodyFatPct })) : [];

  const panels: Panel[] = [
    pick("Fat mass", "fat", "kg", 2, (s) => ({ v: s.totalFatG / 1000, band: fatLsc(s.totalFatG / 1000, p) })),
    pick("Lean mass", "lean", "kg", 2, (s) => ({ v: s.totalLeanG / 1000, band: leanLsc(s.totalLeanG / 1000, p) })),
    { ...pick("Body fat", "pctFat", "%", 1, (s) => ({ v: s.pctFat, band: pctFatLsc(p) })), bg: biaBg, bgLabel: biaBg.length ? BODY_COPY.biaLegend : null },
    pick("Appendicular lean (ALM)", "alm", "kg", 2, (s) => ({ v: s.indices.almKg, band: s.indices.almKg == null ? null : almLsc(s.indices.almKg, p) })),
    pick("Visceral fat (VAT)", "vat", "g", 0, (s) => ({ v: s.vatMassG, band: s.vatMassG == null ? null : vatLsc(s.vatMassG, p) })),
    pick("Total BMD", "bmd", "g/cm²", 3, (s) => ({ v: s.totalBmdGcm2, band: s.totalBmdGcm2 == null ? null : { technical: bmdLsc(s.totalBmdGcm2, s.bmdCvPct ?? p.bmdCvPct ?? 1.0), practical: null } })),
    {
      key: "rmr", title: "Resting metabolic rate", unit: "kcal/d", digits: 0, bg: [], bgSharesAxis: false, bgLabel: null, excludedCount: 0,
      points: tests.map((t) => ({ t: t.testedAt.getTime(), v: t.measuredRmrKcal, band: { technical: rmrLsc(t.measuredRmrKcal, p), practical: null } })),
    },
    {
      ...pick("Weight", "weight", "kg", 1, (s) => ({ v: s.clinicWeightKg, band: null })),
      bg: weightBg,
      bgSharesAxis: true,
      bgLabel: weightBg.length ? "Garmin scale, cleaned (7-day median, > 3 kg outliers excluded)" : null,
      excludedCount: bia?.weight.excluded.length ?? 0,
    },
    {
      key: "biaRaw", title: "Body fat (scale)", unit: "%", digits: 1, points: [], bg: rawBiaBg, bgSharesAxis: true,
      bgLabel: rawBiaBg.length ? BODY_COPY.biaRawLegend : null, excludedCount: 0,
    },
  ];
  return panels.filter((pl) => pl.points.length > 0 || pl.bg.length > 0);
}

function PanelSvg({ panel, tMin, tMax, n, forwardLabel, shades }: { panel: Panel; tMin: number; tMax: number; n: number; forwardLabel: boolean; shades: Shade[] }) {
  const left = PAD.left, right = W - PAD.right, top = PAD.top, bottom = H - PAD.bottom;
  const xOf = (t: number) => (tMax === tMin ? (left + right) / 2 : left + ((t - tMin) / (tMax - tMin)) * (right - left));

  const ys: number[] = [];
  for (const pt of panel.points) {
    ys.push(pt.v);
    if (pt.band) { const w = pt.band.practical ?? pt.band.technical; ys.push(pt.v + w, pt.v - w); }
  }
  // The background sizes the axis only when it shares the quantity, or when there is nothing else to size it.
  if (panel.bgSharesAxis || ys.length === 0) for (const b of panel.bg) ys.push(b.v);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (lo === hi) { const pad = Math.abs(lo) * 0.05 || 1; lo -= pad; hi += pad; }
  const span = hi - lo; lo -= span * 0.15; hi += span * 0.15;
  const yOf = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (bottom - top);

  const pts = [...panel.points].sort((a, b) => a.t - b.t);
  const nextX = (i: number) => (i + 1 < pts.length ? xOf(pts[i + 1].t) : xOf(pts[i].t + FORWARD_DAYS * DAY));
  const bgSorted = [...panel.bg].sort((a, b) => a.t - b.t);
  const bgPath = bgSorted.map((b, i) => `${i === 0 ? "M" : "L"}${xOf(b.t).toFixed(1)},${yOf(b.v).toFixed(1)}`).join(" ");
  const linePath = pts.map((c, i) => `${i === 0 ? "M" : "L"}${xOf(c.t).toFixed(1)},${yOf(c.v).toFixed(1)}`).join(" ");
  const latest = pts[pts.length - 1];
  const clipId = `clip-${panel.key}`;

  return (
    <div className={CARD}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{panel.title}</p>
        {latest && (
          <p className="text-sm tabular-nums text-ink">
            {latest.v.toFixed(panel.digits)}<span className="ml-1 text-xs text-muted">{panel.unit}</span>
          </p>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} aria-label={`${panel.title}, ${pts.length} scan point(s) with noise bands`}>
        <defs>
          <clipPath id={clipId}><rect x={left} y={top} width={right - left} height={bottom - top} /></clipPath>
        </defs>
        {/* 0. Life-event windows — under the bands, clipped to the plot; a window is context, never a signal. */}
        {shades.map((sh) => {
          const x0 = Math.max(left, xOf(sh.t0)), x1 = Math.min(right, xOf(sh.t1));
          if (x1 <= x0) return null;
          return (
            <rect key={`ev-${panel.key}-${sh.key}`} x={x0} y={top} width={x1 - x0} height={bottom - top} fill={EVENT_FILL[sh.kind]} fillOpacity="0.12" clipPath={`url(#${clipId})`}>
              <title>{sh.title}</title>
            </rect>
          );
        })}
        {/* 1. Bands first — they must sit under everything else. */}
        {pts.map((pt, i) => pt.band && (
          <g key={`band-${panel.key}-${i}`}>
            {pt.band.practical != null && (
              <rect x={xOf(pt.t)} y={yOf(pt.v + pt.band.practical)} width={Math.max(0, nextX(i) - xOf(pt.t))} height={Math.max(0, yOf(pt.v - pt.band.practical) - yOf(pt.v + pt.band.practical))} fill="rgb(var(--muted))" fillOpacity="0.10" />
            )}
            <rect x={xOf(pt.t)} y={yOf(pt.v + pt.band.technical)} width={Math.max(0, nextX(i) - xOf(pt.t))} height={Math.max(0, yOf(pt.v - pt.band.technical) - yOf(pt.v + pt.band.technical))} fill="rgb(var(--muted))" fillOpacity="0.22" />
          </g>
        ))}
        {/* 2. Faint dashed background series (never a measurement). */}
        {bgSorted.length >= 2 && <path d={bgPath} clipPath={`url(#${clipId})`} fill="none" stroke="rgb(var(--muted))" strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.5" />}
        {bgSorted.length === 1 && <circle cx={xOf(bgSorted[0].t)} cy={yOf(bgSorted[0].v)} r="2" clipPath={`url(#${clipId})`} fill="rgb(var(--muted))" fillOpacity="0.5" />}
        {/* 3. Axis */}
        <line x1={left} y1={bottom} x2={right} y2={bottom} stroke="rgb(var(--muted))" strokeWidth="0.5" strokeOpacity="0.4" />
        {/* 4. Line only when three or more points exist. */}
        {n >= 3 && pts.length >= 3 && <path d={linePath} fill="none" stroke="rgb(var(--muted))" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.7" />}
        {/* 5. Points last. */}
        {pts.map((pt, i) => (
          <circle key={`pt-${panel.key}-${i}`} cx={xOf(pt.t)} cy={yOf(pt.v)} r="4" fill="rgb(var(--ink))" stroke="rgb(var(--surface))" strokeWidth="1" />
        ))}
        <text x={left - 4} y={top + 3} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{hi.toFixed(panel.digits)}</text>
        <text x={left - 4} y={bottom} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{lo.toFixed(panel.digits)}</text>
        <text x={left} y={H - 6} fontSize="9" fill="rgb(var(--muted))">{fmtDateShort(new Date(tMin))}</text>
        <text x={right} y={H - 6} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{fmtDateShort(new Date(tMax))}</text>
        {forwardLabel && latest && latest.band && (
          <text x={Math.min(right - 2, xOf(latest.t) + 6)} y={Math.max(top + 9, yOf(latest.v + latest.band.technical) - 3)} fontSize="8" fill="rgb(var(--muted))">± LSC forward</text>
        )}
      </svg>
      <p className="mt-1 text-[10px] text-muted">
        {pts.length === 0 ? "No scan point yet." : pts.some((pt) => pt.band != null) ? `Dark band ± technical LSC${pts.some((pt) => pt.band?.practical != null) ? ", light band ± practical LSC" : ""}.` : "Clinic scale weight at each scan; no noise band is defined for weight."}
        {panel.bgLabel ? ` Dashed: ${panel.bgLabel}.` : ""}
        {panel.excludedCount > 0 ? ` ${panel.excludedCount} scale reading${panel.excludedCount === 1 ? "" : "s"} excluded.` : ""}
      </p>
    </div>
  );
}

export function ScanSeries(props: Props) {
  const panels = buildPanels(props);
  const n = props.scans.length;
  if (panels.length === 0) return null;
  const ts = panels.flatMap((pl) => [...pl.points.map((x) => x.t), ...pl.bg.map((x) => x.t)]);
  const latestScanT = Math.max(...props.scans.map((s) => s.scannedAt.getTime()));
  const tMin = Math.min(...ts);
  const tMax = Math.max(latestScanT + FORWARD_DAYS * DAY, ...ts);
  // Windows never size the axis: only those overlapping the plotted range are drawn.
  const shades = shadesFor(props.lifeEvents ?? []).filter((sh) => sh.t1 > tMin && sh.t0 < tMax);
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-medium text-muted">Scan series with noise bands</h2>
      <p className="mb-3 text-xs text-muted">
        {n === 1 ? `${BODY_COPY.ribbonForward}. ` : ""}
        Bands: {precisionLabel(props.precision)}.{n < 3 ? " No line joins points until three scans exist." : ""}
        {shades.length > 0 ? ` ${BODY_COPY.lifeEventsLegend}` : ""}
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {panels.map((pl) => <PanelSvg key={pl.key} panel={pl} tMin={tMin} tMax={tMax} n={n} forwardLabel={n === 1} shades={shades} />)}
      </div>
    </section>
  );
}
