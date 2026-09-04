/**
 * Nearest-labs subset for the body-composition view — pure, no I/O.
 *
 * Fixed subset, fixed order (spec §5.1.6). Aliases match `Biomarker.name` on
 * whole tokens after normalisation (lower-case, every non-alphanumeric run
 * collapsed to one space), so "free t" cannot hit "Free T4" and "ast" cannot
 * hit "Glucose (Fasting)". `exclude` tokens veto a name outright.
 */
export interface LabSubsetDef {
  label: string;
  aliases: string[];
  exclude?: string[];
}

export const LAB_SUBSET: LabSubsetDef[] = [
  { label: "IGF-1", aliases: ["igf-1", "igf1", "igf 1"] },
  { label: "Total testosterone", aliases: ["testosterone"], exclude: ["free"] },
  { label: "Free testosterone", aliases: ["free testosterone", "free t"], exclude: ["t3", "t4"] },
  { label: "SHBG", aliases: ["shbg"] },
  { label: "TSH", aliases: ["tsh"] },
  { label: "Free T4", aliases: ["free t4", "ft4"] },
  { label: "Free T3", aliases: ["free t3", "ft3"] },
  { label: "ALT", aliases: ["alt"] },
  { label: "AST", aliases: ["ast"], exclude: ["fasting", "glucose"] },
  { label: "HbA1c", aliases: ["hba1c"] },
  { label: "Insulin", aliases: ["insulin"] },
  // Most specific first — `labAliasRank` picks the lowest index when a panel holds both "CRP" and an hs variant.
  { label: "hsCRP", aliases: ["hscrp", "hs-crp", "hs crp", "crp hs", "crp"] },
  { label: "Ferritin", aliases: ["ferritin"] },
  { label: "Vitamin D", aliases: ["vitamin d", "vitamin d3", "25-oh", "25 oh"] },
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Lower-case, non-alphanumeric runs → single space, trimmed. */
export function normaliseLabName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** True when `token` (itself normalised) appears in `normalised` on word boundaries. */
function hasToken(normalised: string, token: string): boolean {
  const t = normaliseLabName(token);
  if (!t) return false;
  return new RegExp(`(^| )${escapeRe(t)}( |$)`).test(normalised);
}

/**
 * Index of the first alias of `def` that `name` matches (aliases are listed most
 * specific first), or null when it matches none. Lower = more specific: with a
 * panel holding both "CRP" and "hsCRP", the hsCRP row takes rank 0 over rank 3.
 */
export function labAliasRank(name: string, def: LabSubsetDef): number | null {
  const n = normaliseLabName(name);
  if (def.exclude?.some((x) => hasToken(n, x))) return null;
  const i = def.aliases.findIndex((a) => hasToken(n, a));
  return i < 0 ? null : i;
}

/** Does this biomarker name belong to the subset row `def`? */
export function matchesLabAlias(name: string, def: LabSubsetDef): boolean {
  return labAliasRank(name, def) != null;
}
