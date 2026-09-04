// src/lib/body-figure-core.ts — PURE. No I/O, no React, no Date.now().
/**
 * Builds the serialisable model the /body figure draws. The figure is a rendered
 * anatomy (public/body/figure/*) split once into bone, lean and fat layers and a
 * six-region map; at run time each layer is lit per region from these numbers.
 *
 * Levels: layer brightness follows the tissue's share of the region's mass (bone:
 * BMD) on FIXED domains, so the same brightness means the same value on every
 * scan; the fat hue warms with the region's fat percentage.
 * Change: each region carries the delta of its fat percentage versus the
 * previous scan, tiered with the app's LSC logic. Nothing here judges a value or
 * attributes a change to anything.
 */
import {
  deltaFlag, demoteFlag, distributionRatios, indices, limbAsymmetry, pctFatLsc,
  type ChangeTier, type LscBand, type Precision, type Region, type RegionValues, type ScanValues,
} from "@/lib/body-comp-core";

export const FIGURE_REGIONS = ["head", "l_arm", "r_arm", "trunk", "l_leg", "r_leg"] as const;
export type FigureRegion = (typeof FIGURE_REGIONS)[number];
export const BAND_REGIONS = ["android", "gynoid"] as const;
export type BandRegion = (typeof BAND_REGIONS)[number];

export const REGION_LABEL: Record<Region, string> = {
  head: "Head", l_arm: "Left arm", r_arm: "Right arm", trunk: "Trunk", l_leg: "Left leg", r_leg: "Right leg", android: "Android", gynoid: "Gynoid",
};

/** Fixed drawing domains (value → 0..1). Deliberately steep so a real change is visible. */
export const LAYER_DOMAIN = {
  fatShare: [0.12, 0.26],
  leanShare: [0.68, 0.84],
  bmd: [0.7, 2.2],
  /** Regional % fat over which the fat hue slides from the pack's cool tone to its warm tone. */
  fatHuePct: [12, 28],
} as const;
/** Brightness floor per layer so a region never goes fully dark. */
export const LAYER_FLOOR = { fat: 0.18, lean: 0.25, bone: 0.3 } as const;

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** Linear map of `v` from [lo, hi] onto [a, b], clamped. */
export const mapRange = (v: number, lo: number, hi: number, a: number, b: number) => a + (b - a) * clamp01((v - lo) / (hi - lo));

export interface LayerStrengths { fat: number; lean: number; bone: number }

export interface FigureDelta {
  /** Percentage points of fat, this scan minus the previous. */
  fatPts: number;
  leanPts: number;
  fatKg: number;
  tier: ChangeTier;
  demoted: boolean;
  multipleOfTechnical: number;
}

export interface FigureCell {
  region: Region;
  label: string;
  /** As printed on the report. */
  pctFat: number;
  /** lean ÷ (fat + lean + BMC) × 100. */
  pctLean: number;
  /** BMC ÷ (fat + lean + BMC) × 100; null where the report prints no BMC (android, gynoid). */
  pctBone: number | null;
  /** Drawing shares — normalised over fat + lean + BMC so the three always sum to 1. */
  fatShare: number;
  leanShare: number;
  boneShare: number;
  fatKg: number;
  leanKg: number;
  totalKg: number;
  bmcG: number | null;
  bmdGcm2: number | null;
  /** Versus the previous scan; null at n = 1, when the pair is not comparable, or when the previous report lacks the region. */
  delta: FigureDelta | null;
}

/** Whole-body totals for the idle state of the summary panel. All as printed by the report. */
export interface WholeBody {
  /** DXA total mass (fat + lean + BMC), kg — not the clinic scale weight. */
  massKg: number;
  /** Clinic scale weight, kg; null when the report did not print one. */
  clinicWeightKg: number | null;
  fatKg: number;
  leanKg: number;
  bmcKg: number;
  pctFat: number;
  /** Fat-free mass index and appendicular lean mass index, kg/m². */
  ffmi: number;
  almi: number | null;
  totalBmdGcm2: number | null;
}

export interface FigureChange {
  prevScanId: string;
  prevScannedAtMs: number;
  prevLocalDay: string;
  /** The %fat noise band applied to every region (the scanner prints no regional precision). */
  band: LscBand;
  /** Tiers were lowered one step for reduced comparability (different scanner / software). */
  demoted: boolean;
}

export interface BodyFigureModel {
  paint: "art";
  scanId: string;
  scannedAtMs: number;
  localDay: string;
  /** `FIGURE_REGIONS` order, only the regions the report printed. */
  regions: FigureCell[];
  /** android, gynoid — only those printed. Not drawn on the art; listed in the table. */
  bands: FigureCell[];
  /** Regions/bands absent on this scan. */
  missing: Region[];
  /** Whole-body totals as printed, shown when no region is selected. */
  wholeBody: WholeBody;
  ratios: ReturnType<typeof distributionRatios>;
  asymmetry: ReturnType<typeof limbAsymmetry>;
  /** Present when a comparable previous scan exists. */
  change: FigureChange | null;
}

/** Layer brightness for one region — the same inputs always give the same brightness. */
export function layerStrengths(c: Pick<FigureCell, "fatShare" | "leanShare" | "bmdGcm2">): LayerStrengths {
  return {
    fat: mapRange(c.fatShare, LAYER_DOMAIN.fatShare[0], LAYER_DOMAIN.fatShare[1], LAYER_FLOOR.fat, 1),
    lean: mapRange(c.leanShare, LAYER_DOMAIN.leanShare[0], LAYER_DOMAIN.leanShare[1], LAYER_FLOOR.lean, 1),
    bone: mapRange(c.bmdGcm2 ?? LAYER_DOMAIN.bmd[0], LAYER_DOMAIN.bmd[0], LAYER_DOMAIN.bmd[1], LAYER_FLOOR.bone, 1),
  };
}

/** 0 = the pack's cool fat tone, 1 = its warm tone. */
export function fatHueT(pctFat: number): number {
  return mapRange(pctFat, LAYER_DOMAIN.fatHuePct[0], LAYER_DOMAIN.fatHuePct[1], 0, 1);
}

function cell(r: RegionValues): Omit<FigureCell, "delta"> {
  const bmc = r.bmcG ?? 0;
  const denom = r.fatG + r.leanG + bmc;
  const share = (g: number) => (denom > 0 ? g / denom : 0);
  return {
    region: r.region,
    label: REGION_LABEL[r.region],
    pctFat: r.pctFat,
    pctLean: share(r.leanG) * 100,
    pctBone: r.bmcG == null ? null : share(bmc) * 100,
    fatShare: share(r.fatG),
    leanShare: share(r.leanG),
    boneShare: share(bmc),
    fatKg: r.fatG / 1000,
    leanKg: r.leanG / 1000,
    totalKg: r.totalG / 1000,
    bmcG: r.bmcG,
    bmdGcm2: r.bmdGcm2 ?? null,
  };
}

export interface BuildOptions {
  /** The scan before `scan` (oldest → newest order), if any. */
  prev?: ScanValues | null;
  precision?: Precision | null;
  /** From the interval between `prev` and `scan`: `hidden` suppresses the change view, `demote` lowers every tier one step. */
  comparability?: { hidden: boolean; demote: boolean } | null;
}

export function buildBodyFigureModel(scan: ScanValues, opts: BuildOptions = {}): BodyFigureModel {
  const byRegion = new Map<Region, RegionValues>(scan.regions.map((r) => [r.region, r]));
  const prev = opts.prev ?? null;
  const comparable = prev != null && opts.precision != null && !(opts.comparability?.hidden ?? false);
  const band = comparable ? pctFatLsc(opts.precision!) : null;
  const demote = comparable && (opts.comparability?.demote ?? false);
  const prevBy = new Map<Region, RegionValues>((prev?.regions ?? []).map((r) => [r.region, r]));

  const withDelta = (r: RegionValues): FigureCell => {
    const base = cell(r);
    const p = band ? prevBy.get(r.region) : undefined;
    if (!band || !p) return { ...base, delta: null };
    const pc = cell(p);
    let flag = deltaFlag(p.pctFat, r.pctFat, band);
    if (demote) flag = demoteFlag(flag);
    return { ...base, delta: { fatPts: flag.delta, leanPts: base.pctLean - pc.pctLean, fatKg: base.fatKg - pc.fatKg, tier: flag.tier, demoted: !!flag.demoted, multipleOfTechnical: flag.multipleOfTechnical } };
  };
  const pick = (keys: readonly Region[]) => keys.flatMap((k) => { const r = byRegion.get(k); return r ? [withDelta(r)] : []; });
  const wanted: Region[] = [...FIGURE_REGIONS, ...BAND_REGIONS];
  return {
    paint: "art",
    scanId: scan.id,
    scannedAtMs: scan.scannedAt.getTime(),
    localDay: scan.localDay,
    regions: pick(FIGURE_REGIONS),
    bands: pick(BAND_REGIONS),
    missing: wanted.filter((k) => !byRegion.has(k)),
    wholeBody: (() => {
      const ix = indices(scan);
      return {
        massKg: scan.totalMassG / 1000,
        clinicWeightKg: scan.clinicWeightKg,
        fatKg: scan.totalFatG / 1000,
        leanKg: scan.totalLeanG / 1000,
        bmcKg: scan.totalBmcG / 1000,
        pctFat: scan.pctFat,
        ffmi: ix.ffmi,
        almi: ix.almi,
        totalBmdGcm2: scan.totalBmdGcm2,
      };
    })(),
    ratios: distributionRatios(scan),
    asymmetry: limbAsymmetry(scan.regions),
    change: band && prev ? { prevScanId: prev.id, prevScannedAtMs: prev.scannedAt.getTime(), prevLocalDay: prev.localDay, band, demoted: demote } : null,
  };
}
