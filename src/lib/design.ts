/**
 * Runtime design pack selector.
 *
 * The active design is chosen at server start by the `DESIGN` environment
 * variable (NOT a build-time constant), mirroring how ENV_LABEL is read in
 * layout.tsx — so the SAME built image can be deployed as either design by
 * flipping the env var. When `DESIGN` is unset (or anything other than
 * "pitstop"), the app stays on the original neon-teal "current" design.
 *
 * This is read server-side (root layout) and surfaced to the whole tree via the
 * `data-design` attribute on <html>; all design-pack styling keys off that
 * attribute in globals.css, so client components never need to read the env.
 */
export function activeDesign(): "pitstop" | "current" {
  return (process.env.DESIGN || "").toLowerCase() === "pitstop" ? "pitstop" : "current";
}

/**
 * User-facing brand name for the active design pack. The pitstop pack rebrands
 * the app to "Peptide Pitstop"; every other design keeps "Peptide Tracker".
 * Read server-side (same env source as activeDesign) so the same built image
 * shows the right name per deployment.
 */
export function brandName(): "Peptide Pitstop" | "Peptide Tracker" {
  return activeDesign() === "pitstop" ? "Peptide Pitstop" : "Peptide Tracker";
}
