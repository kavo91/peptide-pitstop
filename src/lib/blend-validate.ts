/**
 * Validation for a blend's component set. Pure, so the rules are unit-tested
 * without a database and cannot drift from the server action that enforces them.
 */
import type { BlendSource } from "./blends-core";

const SOURCES: readonly string[] = ["label", "coa", "assumed"];

export interface BlendComponentDraft {
  componentPeptideId: string;
  massMg: string;
  source: string;
  sortIndex: number;
}

export interface ValidatedBlendComponent {
  componentPeptideId: string;
  massMg: number;
  source: BlendSource;
  sortIndex: number;
}

export type ValidationResult =
  | { ok: true; rows: ValidatedBlendComponent[] }
  | { ok: false; error: string };

export function validateBlendComponents(
  blendPeptideId: string,
  drafts: BlendComponentDraft[],
): ValidationResult {
  const seen = new Set<string>();
  const rows: ValidatedBlendComponent[] = [];

  for (const d of drafts) {
    if (d.componentPeptideId === blendPeptideId) {
      return { ok: false, error: "A blend cannot contain itself." };
    }
    if (seen.has(d.componentPeptideId)) {
      return { ok: false, error: "Each component may appear only once." };
    }
    seen.add(d.componentPeptideId);

    const massMg = Number(d.massMg);
    if (!Number.isFinite(massMg) || massMg <= 0) {
      return { ok: false, error: "Every component needs a mass greater than zero." };
    }
    if (!SOURCES.includes(d.source)) {
      return { ok: false, error: "Source must be label, coa or assumed." };
    }

    rows.push({
      componentPeptideId: d.componentPeptideId,
      massMg,
      source: d.source as BlendSource,
      sortIndex: d.sortIndex,
    });
  }

  return { ok: true, rows };
}
