/**
 * Server-side cycle helpers — the impure edge around lib/cycle's pure core.
 *
 * Two jobs:
 *   1. {@link cycleSuggestionsFor} — resolve the literature-derived cycle
 *      suggestion for a set of peptides, so the protocol FORM can offer one
 *      without pulling the ~200 KB enrichment seed into the client bundle.
 *      The map it returns is a few hundred bytes.
 *   2. {@link getCycleAlerts} — load a user's active protocols and evaluate
 *      their cycle plans, for the banner and the reminder dispatch.
 */
import "server-only";
import { prisma } from "@/lib/db";
import { getEnrichmentSeed } from "@/lib/peptide-enrichment";
import { suggestCycle, type CycleSuggestion } from "./suggest";
import { cycleAlerts, bannerAlerts, type CycleAlert, type CycleProtocol } from "./alerts";
import type { CycleBannerItem } from "@/components/CycleBanner";

/**
 * Cycle suggestions keyed by peptide id, for the peptides offered in a form.
 *
 * Reads the SYNC seed (no DB round-trip per peptide): the enrichment refresh
 * only ever rewrites the same fields the seed carries, and a cycle suggestion
 * is a prefill hint, not a figure worth a per-render query fan-out.
 */
export async function cycleSuggestionsFor(
  peptides: readonly { id: string; name: string }[],
): Promise<Record<string, CycleSuggestion>> {
  const out: Record<string, CycleSuggestion> = {};
  // Aliases matter for matching (e.g. "GHK-Cu" vs "Copper Peptide"), and the
  // option loaders don't carry them — one query covers every peptide at once.
  const rows = await prisma.peptide.findMany({
    where: { id: { in: peptides.map((p) => p.id) } },
    select: { id: true, name: true, aliases: true },
  });
  const aliasById = new Map(rows.map((r) => [r.id, r.aliases ?? undefined]));

  for (const p of peptides) {
    const raw = aliasById.get(p.id);
    // Peptide.aliases is a JSON array string; tokens() wants comma-separated.
    let aliases: string | undefined;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        aliases = Array.isArray(parsed) ? parsed.join(",") : String(raw);
      } catch {
        aliases = raw; // already a plain comma list
      }
    }
    out[p.id] = suggestCycle(getEnrichmentSeed(p.name, aliases));
  }
  return out;
}

/**
 * Live cycle alerts for a user on `today`, most urgent first.
 *
 * Only `active` protocols are loaded — completed/paused ones are exactly how a
 * user dismisses a cycle alert, and cycleAlerts() drops them anyway. Protocols
 * with no cycle plan fall out in the pure layer (cycleState returns null).
 */
export async function getCycleAlerts(userId: string, today: Date): Promise<CycleAlert[]> {
  const rows = await prisma.protocol.findMany({
    where: { userId, status: "active", cycleOnWeeks: { not: null } },
    select: {
      id: true,
      status: true,
      startDate: true,
      cycleAnchor: true,
      cycleOnWeeks: true,
      cycleOffWeeks: true,
      peptide: { select: { name: true } },
    },
  });

  const protocols: CycleProtocol[] = rows.map((r) => ({
    id: r.id,
    peptideName: r.peptide.name,
    // The anchor is the CURRENT cycle's start; startDate is the fallback for
    // every protocol that predates cycling (and for first cycles generally).
    anchor: r.cycleAnchor ?? r.startDate,
    onWeeks: r.cycleOnWeeks,
    offWeeks: r.cycleOffWeeks,
    status: r.status,
  }));

  return cycleAlerts(protocols, today);
}

/**
 * Banner-ready cycle alerts: warn/action only, flattened to serialisable props.
 *
 * A CycleAlert carries a live CycleState with Date fields, which cannot cross
 * the server→client boundary as-is; the banner only needs the rendered strings.
 */
export async function getCycleBannerItems(userId: string, today: Date): Promise<CycleBannerItem[]> {
  return bannerAlerts(await getCycleAlerts(userId, today)).map((a) => ({
    protocolId: a.protocolId,
    peptideName: a.peptideName,
    kind: a.kind,
    level: a.level,
    title: a.title,
    body: a.body,
  }));
}
