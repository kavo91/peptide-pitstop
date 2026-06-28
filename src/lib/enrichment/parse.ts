/**
 * Pure HTML -> EnrichmentEntry parser for peptidedosages.com single-peptide pages.
 *
 * No network, no DOM library -- resilient string/regex extraction (no parser dep
 * is in package.json, and the source markup is consistent and regex-friendly).
 * Every extractor is defensive: a missing section yields an empty array / null,
 * never a throw. Keep this pure so the scraper and unit tests share it.
 *
 * Source page anatomy (verified June 2026):
 *   <h2>{Name} Dosage Chart</h2> ... <p class="dch-lead"> = dose-range sentence
 *   <h2>Standard / Gradual Approach (3 mL = ~1.67 mg/mL)</h2> -> titration <table>
 *   <h2>Advanced / Aggressive Protocol (...)</h2>             -> titration <table>
 *   <h3>Reconstitution Steps</h3>                            -> <ol>/<ul> of steps
 *   <h2>How This Works</h2>                                  -> mechanism <p>s
 *   <h2>(Clinical|Potential) Benefits & Side Effects</h2>    -> benefits/side lists
 *       (Retatrutide splits into <h3>Benefits</h3>/<h3>Side Effects</h3>;
 *        BPC-157 lists directly under the h2)
 *   <h2>References</h2>                                       -> <li> w/ outbound <a>
 */

import type {
  EnrichmentReference,
  EnrichmentTemplate,
  EnrichmentRampStep,
} from "../peptide-enrichment";

// -- low-level text helpers ---------------------------------------------------

/** Strip all tags, drop <sup> reference markers, decode entities, collapse ws. */
export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "") // drop [1][2] ref markers
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#8217;": "’",
  "&#8211;": "–",
  "&#8212;": "—",
  "&nbsp;": " ",
  "&deg;": "°",
  "&plusmn;": "±",
  "&mu;": "μ",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&[a-zA-Z]+;|&#\d+;/g, (m) => ENTITY_MAP[m] ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

/**
 * Return the HTML block from the heading whose stripped text matches `test`
 * until the next heading of level <= `untilLevel` (default: same as the matched
 * heading), or end of document. Returns null if no heading matches.
 */
function sectionAfterHeading(
  html: string,
  test: (text: string, level: number) => boolean,
  opts: { untilLevel?: number } = {},
): string | null {
  const headingRe = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(html))) {
    const level = parseInt(m[1], 10);
    const text = stripHtml(m[2]);
    if (!test(text, level)) continue;

    const start = m.index + m[0].length;
    const until = opts.untilLevel ?? level;
    // Find the next heading at level <= until.
    const tailRe = /<h([1-6])\b[^>]*>/gi;
    tailRe.lastIndex = start;
    let t: RegExpExecArray | null;
    let end = html.length;
    while ((t = tailRe.exec(html))) {
      if (parseInt(t[1], 10) <= until) {
        end = t.index;
        break;
      }
    }
    return html.slice(start, end);
  }
  return null;
}

/** All <li> inner texts within a block (cleaned). */
function listItems(block: string | null): string[] {
  if (!block) return [];
  return Array.from(block.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi))
    .map((m) => stripHtml(m[1]))
    .filter((t) => t.length > 0);
}

/** First <p> (preferring class="dch-lead") inner text within a block. */
function firstParagraph(block: string | null, preferClass?: string): string | null {
  if (!block) return null;
  if (preferClass) {
    const pref = new RegExp(`<p\\b[^>]*class="[^"]*${preferClass}[^"]*"[^>]*>([\\s\\S]*?)<\\/p>`, "i").exec(block);
    if (pref) {
      const t = stripHtml(pref[1]);
      if (t) return t;
    }
  }
  const m = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(block);
  if (!m) return null;
  const t = stripHtml(m[1]);
  return t || null;
}

/** All <p> texts within a block, joined. */
function joinParagraphs(block: string | null, max = 3): string | null {
  if (!block) return null;
  const ps = Array.from(block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi))
    .map((m) => stripHtml(m[1]))
    .filter(Boolean)
    .slice(0, max);
  const joined = ps.join(" ").trim();
  return joined || null;
}

// -- number parsing ------------------------------------------------------------

/**
 * Extract the leading numeric dose from a cell like "8 mg (8000 mcg)" or
 * "600 mcg (0.6 mg)" or "200 mcg-600 mcg". Returns { value, unit } using the
 * FIRST number+unit pair (the published primary figure), or null.
 */
export function parseDose(label: string): { value: number; unit: string } | null {
  const cleaned = decodeEntities(label).replace(/\s+/g, " ");
  const m = /(\d+(?:\.\d+)?)\s*(mcg|mg|iu|ius|µg|ug)\b/i.exec(cleaned);
  if (!m) return null;
  let unit = m[2].toLowerCase();
  if (unit === "µg" || unit === "ug") unit = "mcg";
  if (unit === "ius") unit = "iu";
  return { value: parseFloat(m[1]), unit };
}

// -- table parsing -------------------------------------------------------------

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/** Parse the FIRST <table> in a block into headers + body rows. */
function parseFirstTable(block: string | null): ParsedTable | null {
  if (!block) return null;
  const tableM = /<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(block);
  if (!tableM) return null;
  const trs = Array.from(tableM[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).map((m) => m[1]);
  if (trs.length === 0) return null;

  const cellsOf = (tr: string) =>
    Array.from(tr.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((m) => stripHtml(m[1]));

  // First row with any <th> (or just the first row) is the header.
  const headerIdx = trs.findIndex((tr) => /<th\b/i.test(tr));
  const hIdx = headerIdx >= 0 ? headerIdx : 0;
  const headers = cellsOf(trs[hIdx]);
  const rows = trs
    .filter((_, i) => i !== hIdx)
    .map(cellsOf)
    .filter((r) => r.length > 0);
  return { headers, rows };
}

// -- section extractors (exported for unit testing) ----------------------------

/** Dose-range reference sentence from the "{Name} Dosage Chart" section. */
export function extractDosingReference(html: string): string | null {
  const block = sectionAfterHeading(html, (t) => /dosage chart$/i.test(t), { untilLevel: 3 });
  return firstParagraph(block, "dch-lead");
}

/** Mechanism summary from the "How This Works" section. */
export function extractMechanism(html: string): string | null {
  const block = sectionAfterHeading(html, (t) => /^how this works$/i.test(t), { untilLevel: 2 });
  return joinParagraphs(block, 3);
}

/** Reconstitution steps from the "Reconstitution Steps" section. */
export function extractReconstitution(html: string): string[] {
  const block = sectionAfterHeading(html, (t) => /reconstitution steps?$/i.test(t), { untilLevel: 3 });
  return listItems(block);
}

/**
 * Benefits + side-effects. Handles both layouts:
 *   - h3 "Benefits" / h3 "Side Effects" inside the h2 block (Retatrutide)
 *   - lists directly under the h2 (BPC-157) -> split by <ul> count, else all->benefits
 */
export function extractBenefitsAndSideEffects(html: string): {
  benefits: string[];
  sideEffects: string[];
} {
  // Heading variants seen across the source: "(Clinical|Potential) Benefits &
  // Side Effects" and (GHK-Cu) "Potential Benefits & Observed Effects". Match any
  // "Benefits & <Side|Observed> Effects" heading.
  const block = sectionAfterHeading(html, (t) => /benefits\s*&\s*(side|observed)\s*effects$/i.test(t), { untilLevel: 2 });
  if (!block) return { benefits: [], sideEffects: [] };

  const benefitsSub = sectionAfterHeading(block, (t) => /^benefits$/i.test(t), { untilLevel: 3 });
  const sideSub = sectionAfterHeading(block, (t) => /^side effects?$/i.test(t), { untilLevel: 3 });

  if (benefitsSub || sideSub) {
    return { benefits: listItems(benefitsSub), sideEffects: listItems(sideSub) };
  }

  // No sub-headings -- there may be two <ul>s (benefits then side-effects) or one.
  const uls = Array.from(block.matchAll(/<ul\b[^>]*>[\s\S]*?<\/ul>/gi)).map((m) => m[0]);
  if (uls.length >= 2) {
    return { benefits: listItems(uls[0]), sideEffects: listItems(uls[1]) };
  }
  // Single mixed list (e.g. BPC-157 "Observations") with no structural split:
  // route safety/tolerability caveats to sideEffects by keyword; the rest stay
  // benefits. Deterministic fact routing -- no fabrication.
  return splitByKeyword(listItems(block));
}

/** Adverse/safety phrasing that marks an item as a side-effect / caveat. */
const SIDE_EFFECT_RE =
  /\b(side effect|adverse|tolerab|injection[- ]site|reaction|nausea|vomit|diarrh|headache|dizz|hypoglyc|caution|risk|contraindicat|warning|not (?:be |)recommended|under investigation|safety (?:remain|profile|data))/i;

function splitByKeyword(items: string[]): { benefits: string[]; sideEffects: string[] } {
  const benefits: string[] = [];
  const sideEffects: string[] = [];
  for (const it of items) {
    (SIDE_EFFECT_RE.test(it) ? sideEffects : benefits).push(it);
  }
  return { benefits, sideEffects };
}

/** References list (label + outbound URL) from the "References" section. */
export function extractReferences(html: string): EnrichmentReference[] {
  const block = sectionAfterHeading(html, (t) => /^references$/i.test(t), { untilLevel: 2 });
  if (!block) return [];
  return Array.from(block.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi))
    .map((m) => {
      const inner = m[1];
      // Drop the "View Source" link text that bleeds into the label.
      const label = stripHtml(inner).replace(/\s*View Source\s*$/i, "").trim();
      // Prefer an external href; ignore in-page #ref anchors.
      const hrefs = Array.from(inner.matchAll(/href="([^"]+)"/gi))
        .map((h) => h[1])
        .filter((u) => /^https?:\/\//i.test(u));
      return { label, url: hrefs[0] ?? null } as EnrichmentReference;
    })
    .filter((r) => r.label.length > 0);
}

/**
 * Protocol templates from "Standard / Gradual Approach" and
 * "Advanced / Aggressive Protocol" sections (each a titration table).
 * Frequency is taken from the dosing-reference sentence (weekly vs daily).
 */
export function extractTemplates(html: string): EnrichmentTemplate[] {
  const dosing = extractDosingReference(html) ?? "";
  const isWeekly = /weekly|once weekly|per week|each week/i.test(dosing);
  const isDaily = /daily|per day|each day/i.test(dosing);
  const frequency = isWeekly
    ? "Once weekly (subcutaneous)"
    : isDaily
      ? "Once daily (subcutaneous)"
      : null;
  const doseBasis: EnrichmentTemplate["doseBasis"] = isWeekly ? "per_week" : "per_injection";

  const templates: EnrichmentTemplate[] = [];
  const headingTests: Array<{ name: string; test: (t: string) => boolean }> = [
    { name: "Standard / Gradual Approach", test: (t) => /standard\s*\/\s*gradual approach/i.test(t) },
    { name: "Advanced / Aggressive Protocol", test: (t) => /advanced\s*\/\s*aggressive protocol/i.test(t) },
  ];

  for (const h of headingTests) {
    const block = sectionAfterHeading(html, (t) => h.test(t), { untilLevel: 2 });
    const table = parseFirstTable(block);
    if (!table) continue;

    const ramp = tableToRamp(table);
    // Headline dose = the last (maintenance) phase's dose.
    const lastWithDose = [...ramp].reverse().find((r) => r.dose != null);
    const targetDose = lastWithDose?.dose ?? null;
    const unit = lastWithDose?.unit ?? ramp.find((r) => r.unit)?.unit ?? "mcg";

    templates.push({
      name: h.name,
      doseBasis,
      targetDose,
      unit,
      frequency,
      ...(ramp.length ? { ramp } : {}),
    });
  }
  return templates;
}

/** Reconstitution ratio hint, e.g. "3 mL = ~1.67 mg/mL", from a protocol heading. */
export function extractReconstitutionRatio(html: string): string | null {
  const headingRe = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(html))) {
    const text = stripHtml(m[1]);
    const ratio = /\(([^)]*mg\/mL[^)]*)\)/i.exec(text);
    if (ratio) return ratio[1].trim();
  }
  return null;
}

/** Convert a titration table into ramp steps (phase + dose). */
function tableToRamp(table: ParsedTable): EnrichmentRampStep[] {
  if (table.rows.length === 0) return [];
  // Column 0 = phase ("Weeks 1-4"); the dose column is whichever header mentions
  // "dose" -- fall back to column 1.
  const doseCol = (() => {
    const idx = table.headers.findIndex((h) => /dose/i.test(h));
    return idx >= 0 ? idx : 1;
  })();
  return table.rows
    .map((row) => {
      const phase = row[0] ?? "";
      const doseLabel = row[doseCol] ?? "";
      const parsed = parseDose(doseLabel);
      return {
        phase: phase.trim(),
        dose: parsed?.value ?? null,
        unit: parsed?.unit ?? "",
        doseLabel: doseLabel.trim(),
      } as EnrichmentRampStep;
    })
    .filter((r) => r.phase.length > 0);
}

// -- top-level page parser ----------------------------------------------------

export interface ParsePageResult {
  benefits: string[];
  sideEffects: string[];
  dosingReference: string | null;
  reconstitution: string[];
  reconstitutionRatio: string | null;
  mechanism: string | null;
  templates: EnrichmentTemplate[];
  references: EnrichmentReference[];
}

/** Detect a blend/stack page (skip per task constraints -- single-peptide only). */
export function isBlendOrStack(html: string, url: string): boolean {
  if (/peptide-blend-dosages|peptide-stack-dosages/i.test(url)) return true;
  const titleM = /<title>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleM ? stripHtml(titleM[1]) : "";
  return /\bblend\b|\bstack\b/i.test(title);
}

/** Parse a full single-peptide page HTML string into the extractable fields. */
export function parsePeptidePage(html: string): ParsePageResult {
  const { benefits, sideEffects } = extractBenefitsAndSideEffects(html);
  return {
    benefits,
    sideEffects,
    dosingReference: extractDosingReference(html),
    reconstitution: extractReconstitution(html),
    reconstitutionRatio: extractReconstitutionRatio(html),
    mechanism: extractMechanism(html),
    templates: extractTemplates(html),
    references: extractReferences(html),
  };
}
