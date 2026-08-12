/**
 * Compliance guardrails — "tracking + neutral literature, never advice".
 *
 * Peptide Pitstop is an ADHERENCE / RECORD-KEEPING tool: NOT a medical device
 * (keeps it out of SaMD / TGA / FDA-CDS classification) and NOT a source of
 * individual advice. These constants + guards make that posture enforceable in
 * code rather than a disclaimer footer, so a future feature can't silently ship
 * advice. See the second-brain page: health-app-compliance.
 */

export const MEDICAL_DISCLAIMER =
  "For personal tracking and education only. Not medical advice, diagnosis, or " +
  "treatment, and not a medical device. Peptides may be prescription-only or " +
  "unapproved where you live — consult a licensed healthcare professional.";

export const RESEARCH_DISCLAIMER =
  "Summarised from published literature for reference only, with citations to the " +
  "source. Evidence is graded as reported and is not a recommendation to combine, " +
  "dose, or use any compound.";

/** Evidence grade for a literature reference card — factual, tied to a citation. */
export type EvidenceGrade = "rct" | "human" | "animal" | "mechanistic" | "none";

/** Directive/advice phrasings a compliant, citation-only output must NEVER emit. */
const BANNED_DIRECTIVE: RegExp[] = [
  /\b(?:you|users?|patients?)\s+(?:should|must|need to)\b/i,
  /\bwe recommend\b/i,
  /\b(?:recommended|suggested|optimal|ideal|safe|unsafe)\s+(?:dose|protocol|stack|combination|use)\b/i,
  /\b(?:take|inject|use|avoid)\s+(?:\d|this|these|it|daily|weekly)\b/i,
  /\bstack (?:this|these|it|them|with)\b/i,
  /\bsafe to combine\b/i,
  /\bcontraindicated for you\b/i,
  /\byour (?:optimal|ideal) (?:dose|protocol|stack)\b/i,
];

/**
 * Guard for any AI/literature text that will be shown to a user. Returns the
 * text unchanged if it reads as neutral reference, or throws if it contains
 * directive/advice language. Call at the boundary where model output becomes
 * user-facing content, so an advice regression fails loudly instead of shipping.
 */
export function assertNoDirectiveAdvice(text: string): string {
  for (const re of BANNED_DIRECTIVE) {
    if (re.test(text)) {
      throw new Error(`compliance: directive/advice language is not allowed (matched ${re})`);
    }
  }
  return text;
}

/** A literature reference card must carry a citation (PMID or DOI) to be shown. */
export function isCitedReference(card: {
  citation?: { pmid?: string; doi?: string } | null;
}): boolean {
  if (!card.citation) return false;
  const pmid = card.citation.pmid?.trim() ?? "";
  const doi = card.citation.doi?.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "") ?? "";
  return /^\d{4,10}$/.test(pmid) || /^10\.\d{4,9}\/[A-Za-z0-9._;()/:+-]+$/.test(doi);
}

export interface NeutralLiteratureLink {
  kind: "pubmed" | "doi";
  label: string;
  href: string;
}

export interface NeutralReferenceEntry {
  name: string;
  aliases?: string;
  references: NeutralLiteratureLink[];
}

/** Allow only canonical HTTPS PubMed or DOI links and replace claim-like labels. */
export function toNeutralLiteratureLink(reference: { url?: string | null }): NeutralLiteratureLink | null {
  if (!reference.url) return null;
  let url: URL;
  try {
    url = new URL(reference.url);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname === "pubmed.ncbi.nlm.nih.gov") {
    const match = /^\/(\d{4,10})\/?$/.exec(url.pathname);
    if (!match) return null;
    return { kind: "pubmed", label: `PubMed PMID ${match[1]}`, href: `https://pubmed.ncbi.nlm.nih.gov/${match[1]}/` };
  }
  if (url.hostname === "doi.org" || url.hostname === "dx.doi.org") {
    let doi: string;
    try {
      doi = decodeURIComponent(url.pathname.replace(/^\//, ""));
    } catch {
      return null;
    }
    if (!/^10\.\d{4,9}\/[A-Za-z0-9._;()/:+-]+$/.test(doi)) return null;
    return { kind: "doi", label: `DOI ${doi}`, href: `https://doi.org/${doi}` };
  }
  return null;
}

/** Strip all non-neutral enrichment fields before server data is serialized to the UI. */
export function toNeutralReferenceEntry(entry: {
  name: string;
  aliases?: string;
  references: { url?: string | null }[];
}): NeutralReferenceEntry {
  const references = entry.references
    .map(toNeutralLiteratureLink)
    .filter((reference): reference is NeutralLiteratureLink => reference != null);
  return {
    name: entry.name,
    ...(entry.aliases ? { aliases: entry.aliases } : {}),
    references: Array.from(new Map(references.map((reference) => [reference.href, reference])).values()),
  };
}
