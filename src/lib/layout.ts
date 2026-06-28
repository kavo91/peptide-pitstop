/**
 * Canonical responsive page container. Apply to EVERY top-level content/list page's
 * `<main>` so width, horizontal padding, and breakpoints are byte-identical across
 * the whole app (fixes the per-page width/margin drift — review items D8/D2).
 *
 * Width ladder (single source of truth — do not hand-tune per page):
 *   phone  → max-w-md   (448px)
 *   lg     → max-w-5xl  (1024px) + px-8
 *   1440px → max-w-6xl  (1152px)   ← the laptop "dead-zone" tier
 *   1900px → 1640px                 ← ultra-wide cap (consistent across pages)
 *
 * Vertical padding is py-8 everywhere (no per-page py-6/py-10/lg:py-3 drift).
 * Inner multi-column grids stay per-page; only the OUTER container uses this.
 */
export const PAGE_MAIN =
  "mx-auto max-w-md px-4 py-8 lg:max-w-5xl lg:px-8 min-[1440px]:max-w-6xl min-[1900px]:max-w-[1640px]";
