"use client";

import { useState } from "react";
import { Calculator, ExternalLink, ArrowRight } from "lucide-react";
import type { EnrichmentEntry, EnrichmentTemplate } from "@/lib/peptide-enrichment";
import { effectiveTemplates } from "@/lib/enrichment/suggested-protocol";
import { EnrichmentCalculator } from "./EnrichmentCalculator";

/** Map a template's display unit (mcg|mg|iu) to a calculator DoseUnit. */
function calcUnit(unit: string): "mcg" | "mg" | "ml" | "units" {
  const u = (unit ?? "").trim().toLowerCase();
  if (u === "iu") return "units";
  if (u === "mg") return "mg";
  if (u === "ml") return "ml";
  if (u === "units") return "units";
  return "mcg";
}

/** Best-effort vial mg from "3 mL = ~1.67 mg/mL" → ceil(1.67×3) ≈ 5. Falls back to "5". */
function defaultVialMg(ratio: string | null | undefined): string {
  if (!ratio) return "5";
  const ml = ratio.match(/([\d.]+)\s*mL/i);
  const conc = ratio.match(/([\d.]+)\s*mg\s*\/\s*mL/i);
  if (ml && conc) {
    const mg = Number(ml[1]) * Number(conc[1]);
    if (Number.isFinite(mg) && mg > 0) return String(Math.round(mg * 100) / 100);
  }
  return "5";
}

interface Props {
  entry: EnrichmentEntry;
  /** The user's matching Peptide id, when this peptide is already added. */
  peptideId?: string | null;
  /** Called when the user wants to add this peptide first (Apply on an un-owned peptide). */
  onAddFirst?: () => void;
}

/**
 * Expandable detail panel for a library entry. Renders only the sections that
 * have data, always shows the attribution + "not medical advice" disclaimer,
 * and offers "Apply" on each example template (links to the prefilled protocol
 * form when the peptide is owned, else prompts to add it first).
 *
 * Reference data is from peptidedosages.com — EXAMPLES, never a prescription.
 */
export function PeptideLibraryDetail({ entry, peptideId, onAddFirst }: Props) {
  const [calcOpen, setCalcOpen] = useState(false);

  // The templates we actually offer: real curated ones, else a single synthesized
  // "Suggested protocol (from reference)" for flat-dosed peptides (e.g. GHK-Cu).
  const templates = effectiveTemplates(entry);
  const onlySynthesized = entry.templates.length === 0 && templates.length > 0;

  function applyHref(ti: number): string {
    const params = new URLSearchParams({ template: entry.name, ti: String(ti) });
    if (peptideId) params.set("peptideId", peptideId);
    return `/protocols/new?${params.toString()}`;
  }

  function onApply(ti: number) {
    if (!peptideId) {
      onAddFirst?.();
      return;
    }
    window.location.href = applyHref(ti);
  }

  return (
    <div className="mt-2 space-y-3 rounded-card bg-surface p-3 text-sm shadow-sm ring-1 ring-line/10">
      {entry.benefits.length > 0 && (
        <Section title="Benefits">
          <ul className="list-disc space-y-1 pl-4 text-muted">
            {entry.benefits.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </Section>
      )}

      {entry.dosingReference && (
        <Section title="Dosing reference">
          <p className="text-muted">{entry.dosingReference}</p>
        </Section>
      )}

      {entry.sideEffects.length > 0 && (
        <Section title="Symptoms / side-effects to watch">
          <ul className="list-disc space-y-1 pl-4 text-muted">
            {entry.sideEffects.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </Section>
      )}

      {entry.mechanism && (
        <Section title="Mechanism">
          <p className="text-muted">{entry.mechanism}</p>
        </Section>
      )}

      {templates.length > 0 && (
        <Section title={onlySynthesized ? "Suggested protocol" : "Example protocol templates"}>
          {!peptideId && (
            <p className="mb-2 text-xs text-warn">Add this peptide first to apply a template.</p>
          )}
          <ul className="space-y-2">
            {templates.map((t, ti) => (
              <li key={ti} className="rounded-control bg-bg p-2.5 ring-1 ring-line/10">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{t.name}</p>
                    <p className="text-xs text-muted tabular-nums">{summariseTemplate(t)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onApply(ti)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-control bg-accent px-2.5 py-1.5 text-xs font-medium text-onAccent disabled:opacity-40"
                    aria-label={`Apply ${t.name}`}
                  >
                    Apply <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
                {t.ramp && t.ramp.length > 0 && (
                  <ol className="mt-1.5 space-y-0.5 text-xs text-muted">
                    {t.ramp.map((r, ri) => (
                      <li key={ri} className="tabular-nums">{r.phase}: {r.doseLabel}</li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Calculator">
        <button
          type="button"
          onClick={() => setCalcOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 rounded-control bg-bg px-3 py-1.5 text-xs font-medium text-accentStrong ring-1 ring-line/15"
        >
          <Calculator className="h-3.5 w-3.5" aria-hidden /> {calcOpen ? "Hide calculator" : "Open dose calculator"}
        </button>
        {calcOpen && (
          <div className="mt-2">
            <EnrichmentCalculator
              peptideName={entry.name}
              defaultVialMg={defaultVialMg(entry.reconstitutionRatio)}
              reconstitutionRatio={entry.reconstitutionRatio}
              defaultDose={firstTemplateDose(templates)?.dose}
              defaultDoseUnit={firstTemplateDose(templates)?.unit}
            />
          </div>
        )}
      </Section>

      {entry.references.length > 0 && (
        <Section title="References">
          <ul className="space-y-1">
            {entry.references.map((r, i) => (
              <li key={i} className="text-xs">
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 text-accentStrong">
                    <span>{r.label}</span>
                    <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  </a>
                ) : (
                  <span className="text-muted">{r.label}</span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Attribution + disclaimer — ALWAYS shown wherever dosing data appears. */}
      <p className="border-t border-line/10 pt-2 text-[11px] text-muted">
        Reference data curated from{" "}
        <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accentStrong underline">
          {entry.source}
        </a>
        . For personal reference only — not medical advice.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-ink">{title}</p>
      {children}
    </div>
  );
}

/** One-line summary of a template's headline figure for the list row. */
function summariseTemplate(t: EnrichmentTemplate): string {
  const basis = t.doseBasis === "per_week" ? "per week" : "per injection";
  const dose = t.targetDose != null ? `${t.targetDose} ${t.unit} ${basis}` : "dose varies";
  return t.frequency ? `${dose} · ${t.frequency}` : dose;
}

/** First template's headline dose, to prefill the calculator's target. */
function firstTemplateDose(templates: EnrichmentTemplate[]): { dose: string; unit: "mcg" | "mg" | "ml" | "units" } | undefined {
  const t = templates.find((x) => x.targetDose != null);
  if (!t || t.targetDose == null) return undefined;
  return { dose: String(t.targetDose), unit: calcUnit(t.unit) };
}
