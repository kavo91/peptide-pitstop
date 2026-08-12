import { ExternalLink } from "lucide-react";
import {
  MEDICAL_DISCLAIMER,
  RESEARCH_DISCLAIMER,
  type NeutralReferenceEntry,
} from "@/lib/compliance";

/**
 * Compliance-safe reference panel. Source dosing, benefit, mechanism,
 * reconstitution, side-effect and protocol fields remain stored for provenance
 * but are intentionally not rendered. Only neutral identity metadata and
 * allow-listed PubMed/DOI links cross this UI boundary.
 */
export function PeptideLibraryDetail({ entry }: { entry: NeutralReferenceEntry }) {
  return (
    <div className="mt-2 space-y-3 rounded-card bg-surface p-3 text-sm shadow-sm ring-1 ring-line/10" data-testid="compliance-reference-panel">
      <div>
        <p className="text-xs font-semibold text-ink">Neutral reference metadata</p>
        <p className="mt-1 text-muted">{entry.name}{entry.aliases ? ` · aliases: ${entry.aliases}` : ""}</p>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-ink">Published literature</p>
        {entry.references.length > 0 ? (
          <ul className="space-y-1">
            {entry.references.map((reference) => (
              <li key={reference.href} className="text-xs">
                <a href={reference.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 text-accentStrong">
                  <span>{reference.label}</span>
                  <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">No validated PubMed or DOI link is available for this entry.</p>
        )}
      </div>

      <div className="space-y-1 border-t border-line/10 pt-2 text-[11px] text-muted">
        <p>{RESEARCH_DISCLAIMER}</p>
        <p>{MEDICAL_DISCLAIMER}</p>
      </div>
    </div>
  );
}
