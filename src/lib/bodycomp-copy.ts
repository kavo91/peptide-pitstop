/**
 * Fixed copy strings and template sentences for the body-composition surfaces.
 *
 * Product rule: this view shows measurements and what was logged alongside
 * them. Nothing here attributes a change to any compound, food, training or
 * event. `CAUSAL_VERBS` is the lint list — `bodycomp-copy.test.ts` asserts no
 * string in this module contains any of them.
 */

export const CAUSAL_VERBS = [
  "caused",
  "causes",
  "because of",
  "due to",
  "led to",
  "leads to",
  "resulted in",
  "results in",
  "thanks to",
  "effect of",
  "improved by",
  "worsened by",
  "attributable",
  "drove",
  "driven by",
];

export const BODY_COPY = {
  disclaimer:
    "This view shows measurements and what was logged alongside them. Differences smaller than the noise band are not changes. Nothing here attributes a change to any compound, food, training or event. Not medical advice; discuss abnormal labs or scan results with a clinician.",
  exposureHeader: "Co-occurring exposure between scans — not attribution",
  attributionBlocked: "not logged — attribution blocked",
  biaLegend: "Garmin scale, offset to latest DEXA — estimate, not a measurement",
  percentileNote: "Population position, not a target",
  defaultLsc: "default LSC (device class, not this clinic's precision)",
  ribbonForward: "A future change would need to exceed this band to count",
  noComparator: "pre-baseline context — no comparator scan",
  reducedComparability: "reduced comparability",
  notComparable: "not comparable — different scanner or software",
  neverMeasured: "never measured",
  rmrConditionsUnknown: "test conditions not recorded",
  biaRawLegend: "Garmin scale, uncalibrated bioimpedance — not a DEXA measurement",
  tdeeNote: "arithmetic on the clinic's activity-factor assumption, not a target",
  uploadIntro: "Upload the clinic's PDF. Values are read from its text layer and shown here for review; nothing is saved until you confirm.",
  uploadPass: "Every required anchor was found and every checksum matched. Review the values below, then use them or enter the scan by hand.",
  uploadFail: "The report could not be read in full. The PDF stays attached to this visit; enter the values by hand from the printed report.",
  uploadConfidence: "Confidence = anchors found × checksums passed",
  fromPdf: "from PDF",
  reportLink: "Report (PDF)",
  reportAttached: "Report attached to this scan",
  lifeEventsTitle: "Illness and travel windows",
  lifeEventsIntro: "Days inside a window are shaded on every chart, excluded from interval medians, and counted.",
  lifeEventsLegend: "Shaded windows: illness (amber), travel (teal), other (grey).",
  lifeEventsEmpty: "No windows tagged yet.",
  lifeEventLabelHint: "Short label only, e.g. flu or work trip; details go in notes.",
  lifeEventSaved: "Window saved.",
  lifeEventDeleteConfirm: "Delete this window?",
  reportHeading: "Body composition (DEXA) and resting metabolic rate",
  reportProvenance: "Values as printed by the scanner; noise bands from device-class precision unless the clinic supplied its own.",
  reportEmpty: "No DEXA or RMR recorded in this range.",
  lscFootnote: "× LSC = |Δ| ÷ technical LSC of the earlier scan. Differences smaller than the noise band are not changes.",
  rmrLadderFootnote: "kcal/d = measured RMR. Ratios = measured / predicted for Tinsley 2019 (FFM), Cunningham 1980 and Mifflin-St Jeor (1990; general population, under-predicts trained subjects); the FFM-based ratios need a DEXA within 14 days of the test.",
  flagDemoted: "demoted",
  lifeEventDaysInRange: "Days inside illness / travel windows in this range",
  intervalTableIntro: "Wearable values are medians of contributing days; partial days and days inside illness/travel windows are excluded and counted.",
  lifeEventEndHint: "Blank = the start day only. At most 120 days.",
  ganttScanTag: "DEXA",
  ganttScanLegend: "DEXA scan",
  // ── Regional figure (/body, section 0b) ────────────────────────────────────
  figureTitle: "Regional distribution",
  figureIntro:
    "Bone, lean and fat layers per region, lit by the scan: a brighter fat layer means a higher fat share, a brighter lean layer a higher lean share, brighter bone a higher BMD. The fat hue warms as the region's percentage rises. The number is the region's fat percentage as printed.",
  figureIntroChange:
    "Change view tints each region by how far its fat percentage moved since the previous scan: grey within the noise band, amber indeterminate, accent beyond the practical LSC. The scanner prints no regional precision, so the whole-body fat-percentage band is applied to every region.",
  figureArtNote: "The figure is a rendered anatomy, not the scan image; regions follow the printed report. Android and gynoid are listed in the table only.",
  figureMissing: "A region the report did not print is left unlit.",
  figureTable: "Region table",
  figureLegendLevels: "brightness = share of the region's mass (bone: BMD) · fat hue warms as the % rises",
  figureLegendChange: "fat % vs the previous scan",
  figureWholeBody: "Whole body",
  figureHint: "Hover, tap or focus a region for its numbers.",
  figureHintChange: "Hover, tap or focus a region for its change.",
  figureNote:
    "Regions differ from each other by anatomy. Only a later scan of the same region, beyond the noise band, counts as change.",
  figureViewLabel: "View",
  figureLevels: "Levels",
  figureChange: "Change",
  figureChangeNeedsPrev: "Needs a previous comparable scan",
  figureNoPrevRegion: "not on the previous report",
  figureLoading: "Loading figure…",
  figureUnavailable: "Figure art unavailable. The table below carries every number.",
  figureAriaLevels: "Body figure: bone, lean and fat per region. Use the table for keyboard access to each region.",
  figureAriaChange: "Body figure: change in fat percentage per region since the previous scan. Use the table for keyboard access to each region.",
} as const;

export type DeltaTier = "within_noise" | "indeterminate" | "exceeds_lsc";

export interface IntervalSentenceInput {
  metric: string;
  deltaKg: number;
  days: number;
  tier: DeltaTier;
  technical: number;
  practical: number | null;
  compounds: string[];
  intakeLogged: boolean;
  /** When the flag was demoted for reduced comparability: the tier the numbers alone give, and why it was demoted. */
  demoted?: boolean;
  rawTier?: DeltaTier;
  comparabilityReasons?: string[];
}

const TIER_WORD: Record<DeltaTier, string> = { within_noise: "within noise", indeterminate: "indeterminate", exceeds_lsc: "exceeds LSC" };

export function intervalSentence(x: IntervalSentenceInput): string {
  // The band clause is always worded from the undemoted tier, so it never contradicts the numbers it prints.
  const numeric = x.demoted && x.rawTier ? x.rawTier : x.tier;
  const band =
    numeric === "within_noise"
      ? `this is within the technical LSC (${x.technical.toFixed(2)} kg) — not a change`
      : numeric === "indeterminate"
        ? `this exceeds the technical LSC (${x.technical.toFixed(2)} kg) but not the practical LSC (${x.practical?.toFixed(2) ?? "n/a"} kg) — indeterminate`
        : `this exceeds the practical LSC (${x.practical?.toFixed(2) ?? "n/a"} kg)`;
  const reasons = x.comparabilityReasons?.length ? ` (${x.comparabilityReasons.join("; ")})` : "";
  const tier = x.demoted ? `${band}; the flag is demoted to ${TIER_WORD[x.tier]} for reduced comparability${reasons}` : band;
  const delta = x.deltaKg.toFixed(1);
  const list =
    x.compounds.length === 0
      ? "No compounds were logged during this interval"
      : x.compounds.length === 1
        ? `${x.compounds[0]} was logged during this interval`
        : `${x.compounds.slice(0, -1).join(", ")} and ${x.compounds[x.compounds.length - 1]} were logged during this interval`;
  return `${x.metric} changed by ${x.deltaKg > 0 ? "+" : ""}${delta.startsWith("-") ? `−${delta.slice(1)}` : delta} kg over ${x.days} days; ${tier}. ${list}; ${x.intakeLogged ? "intake was logged" : "intake was not logged"}.`;
}
