/**
 * WCAG 2.1 relative luminance + contrast ratio helpers.
 * Pure functions; no DOM dependency — safe in vitest node env.
 */

/** Parse a 6-digit hex colour (#RRGGBB) into [r, g, b] in 0–255. */
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, "");
  if (clean.length !== 6) throw new Error(`Invalid hex colour: ${hex}`);
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

/** WCAG 2.1 relative luminance of an sRGB colour. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.1 contrast ratio between two colours.
 * Returns a value between 1 (no contrast) and 21 (black on white).
 * Pass colours in any order — the lighter one is automatically used as L1.
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
