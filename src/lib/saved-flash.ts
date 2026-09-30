/**
 * Timing rules for the transient "Saved" confirmation on a save button.
 *
 * A successful `updateProtocol` ends with `revalidatePath()`. When the save
 * changes a value the editor is keyed on, React REMOUNTS the editor and discards
 * component state before "Saved" can paint. (The anchor-held notice in
 * ProtocolEditor has the same problem; it is parked in sessionStorage so the
 * remounted editor picks it back up.)
 *
 * A "Saved" flag gets the same treatment, with one difference: it is time-boxed.
 * A sticky "Saved" parked in storage would still read "Saved" minutes later,
 * under edits the user has since made and NOT saved — worse than showing
 * nothing. So the flash carries the epoch-ms instant it was stamped, and the
 * remaining life is computed from that on every mount.
 *
 * This module is the pure half (no React, no storage) so the rules are testable;
 * `src/components/useSavedFlash.ts` wires it to sessionStorage and a timer.
 */

/** How long "Saved" stays on the button after a successful save. */
export const SAVED_FLASH_MS = 3000;

/** sessionStorage key for one row's flash. `scope` separates the editors that share a protocol id. */
export const savedFlashKey = (scope: string, id: string) => `pt-saved:${scope}:${id}`;

/** The value written to storage: the instant the save succeeded. */
export const stampSavedFlash = (now: number): string => String(now);

/**
 * Milliseconds of flash left for a stored stamp, or 0 when there is nothing to
 * show. 0 also covers every unusable stamp: absent, non-numeric, already
 * expired, or dated in the future (a clock change — treat as stale rather than
 * pinning "Saved" on screen until the clock catches up).
 */
export function savedFlashRemaining(
  raw: string | null,
  now: number,
  windowMs: number = SAVED_FLASH_MS,
): number {
  // "Nothing stored" is spelled out rather than left to fall through, so the
  // common case reads at a glance. Everything else needs no guard of its own:
  // NaN fails every comparison below, and infinities land outside the window.
  if (raw === null || raw.trim() === "") return 0;
  const elapsed = now - Number(raw);
  if (elapsed < 0) return 0; // stamped in the future — a clock change; treat as stale
  const left = windowMs - elapsed;
  return left > 0 ? left : 0;
}
