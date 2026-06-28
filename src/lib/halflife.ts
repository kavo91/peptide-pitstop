/**
 * Half-life / timing utilities — pure, no I/O.
 *
 * decayFraction is exported for reuse by Component 4's plasma superposition model
 * (src/lib/plasma.ts). One decay definition for the whole app.
 */

/**
 * Single-dose remaining fraction at `hoursElapsed` after administration.
 * Formula: 0.5 ^ (hoursElapsed / halfLifeHours)
 */
export function decayFraction(hoursElapsed: number, halfLifeHours: number): number {
  return Math.pow(0.5, hoursElapsed / halfLifeHours);
}

export interface TimingAssessment {
  /** True when hoursSinceLast is within minIntervalHours (non-blocking warning). */
  tooSoon: boolean;
  /**
   * Estimated percentage of the prior dose still active (0–100), or null when
   * halfLifeHours is unknown.
   */
  activePct: number | null;
  /**
   * Human-readable warning string. Empty string when there is nothing to warn.
   * Callers render this only when non-empty.
   */
  message: string;
}

/**
 * Assess whether logging a new dose is too soon and how much of the prior dose
 * remains active.
 *
 * @param halfLifeHours    - From Peptide.halfLifeHours (null = unknown).
 * @param minIntervalHours - From Peptide.minIntervalHours (null = no restriction).
 * @param hoursSinceLast   - Hours since the most recent DoseLog.takenAt for this
 *                           peptide. Pass a large number (e.g. 9999) when no prior
 *                           dose exists — results in tooSoon=false and activePct≈0.
 */
export function assessTiming({
  halfLifeHours,
  minIntervalHours,
  hoursSinceLast,
}: {
  halfLifeHours: number | null;
  minIntervalHours: number | null;
  hoursSinceLast: number;
}): TimingAssessment {
  const tooSoon = minIntervalHours != null && hoursSinceLast < minIntervalHours;

  const activePct =
    halfLifeHours != null
      ? decayFraction(hoursSinceLast, halfLifeHours) * 100
      : null;

  const parts: string[] = [];

  if (tooSoon && minIntervalHours != null) {
    const hoursAgo = Math.round(hoursSinceLast);
    parts.push(`Last dose ${hoursAgo} h ago · min interval ${Math.round(minIntervalHours)} h`);
  }

  if (activePct != null) {
    parts.push(`~${Math.round(activePct)}% still active`);
  }

  return {
    tooSoon,
    activePct,
    message: parts.join(" · "),
  };
}
