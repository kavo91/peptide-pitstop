/**
 * Injection-site rotation — pure constants and LRU suggestion.
 * No I/O. Used by LogDoseForm, AdHocLogForm, and future body-map UI.
 *
 * recentSites: ordered most-recent-first (index 0 = last used).
 * Unrecognised codes (old free-text values) are silently ignored.
 */

export interface SiteOption {
  code: string;
  label: string;
}

export const SITE_OPTIONS: SiteOption[] = [
  { code: "abdomen_L",  label: "Abdomen — Left"       },
  { code: "abdomen_R",  label: "Abdomen — Right"      },
  { code: "thigh_L",    label: "Thigh — Left"         },
  { code: "thigh_R",    label: "Thigh — Right"        },
  { code: "glute_L",    label: "Glute — Left"         },
  { code: "glute_R",    label: "Glute — Right"        },
  { code: "delt_L",     label: "Deltoid — Left"       },
  { code: "delt_R",     label: "Deltoid — Right"      },
  { code: "ventro_L",   label: "Ventroglute — Left"   },
  { code: "ventro_R",   label: "Ventroglute — Right"  },
];

/** Ordered list of all valid site codes — matches SITE_OPTIONS order. */
export const SITE_CODES: string[] = SITE_OPTIONS.map((o) => o.code);

/**
 * Return the site code that should be pre-selected for the next injection.
 * Algorithm: LRU — pick the known site absent from recentSites, or furthest
 * back in it (highest index = least recently used).
 *
 * @param recentSites  Most-recent-first array of site codes from recent DoseLogs.
 *                     Unknown / free-text values are silently ignored.
 */
export function suggestNextSite(recentSites: string[]): string {
  // Build a map: code → last-used index in recentSites (lower = more recent).
  // Codes not present in recentSites are treated as never used (Infinity).
  const lastUsed = new Map<string, number>(SITE_CODES.map((c) => [c, Infinity]));

  for (let i = 0; i < recentSites.length; i++) {
    const code = recentSites[i];
    // Only update if this is the first (most-recent) occurrence of this code.
    if (lastUsed.has(code) && lastUsed.get(code) === Infinity) {
      lastUsed.set(code, i);
    }
  }

  // Pick the site with the highest lastUsed index (least recently used).
  // Ties broken by SITE_CODES order (stable sort preserves insertion order).
  let bestCode = SITE_CODES[0];
  let bestIndex = lastUsed.get(SITE_CODES[0])!;

  for (const code of SITE_CODES) {
    const idx = lastUsed.get(code)!;
    if (idx > bestIndex) {
      bestIndex = idx;
      bestCode = code;
    }
  }

  return bestCode;
}

// ── append to src/lib/sites.ts ─────────────────────────────────────────────

/**
 * Return which silhouette view a site code belongs to.
 * front: abdomen, delt, thigh, ventro
 * back:  glute
 */
const BACK_CODES = new Set(["glute_L", "glute_R"]);

export function zoneView(code: string): "front" | "back" {
  return BACK_CODES.has(code) ? "back" : "front";
}

/**
 * Build a map of code → rank index, where 0 = most recently used.
 * Only the *first* occurrence of each code in recentSites (most-recent-first)
 * is recorded; duplicates are ignored.
 * Unknown codes are included — the caller decides whether to filter.
 */
export function recencyRank(recentSites: string[]): Map<string, number> {
  const seen = new Map<string, number>();
  for (let i = 0; i < recentSites.length; i++) {
    const code = recentSites[i];
    if (!seen.has(code)) seen.set(code, i);
  }
  return seen;
}
