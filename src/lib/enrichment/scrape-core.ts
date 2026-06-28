/**
 * Shared scrape core: fetch + parse + entry-build. Imported by BOTH the CLI
 * scraper (scripts/scrape-peptidedosages.mjs, run via tsx) and the refresh
 * route (src/app/api/enrichment/refresh/route.ts).
 *
 * Network I/O lives here (fetch with a descriptive UA + polite delay), but the
 * orchestration (concurrency, file write) stays in the callers so this module
 * is straightforward to reason about and reuse.
 */

import { PEPTIDE_LIBRARY } from "../peptide-library";
import {
  ENRICHMENT_SOURCE,
  type EnrichmentEntry,
} from "../peptide-enrichment";
import { parsePeptidePage, isBlendOrStack } from "./parse";
import { SLUG_MAP, BLEND_SLUG_MAP, slugUrl, type SlugTarget } from "./slug-map";

export const USER_AGENT =
  "PeptidePitstopBot/1.0 (+self-hosted personal peptide tracker; reference enrichment; contact via repo)";

const ATTRIBUTION = "Reference data curated from peptidedosages.com. Not medical advice.";

/** Sleep helper for polite pacing. */
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fetch one URL as text. Throws on non-2xx so the caller can try a fallback. */
export async function fetchPage(url: string, timeoutMs = 20_000): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: ac.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Look up the library metadata (aliases) for a given name. */
function libraryMeta(name: string): { aliases?: string } {
  const lib = PEPTIDE_LIBRARY.find((p) => p.name === name);
  return { aliases: lib?.aliases };
}

/**
 * Build a full EnrichmentEntry from parsed page fields + library metadata.
 * Pure (no I/O) so it's unit-testable. `curatedAt` defaults to now.
 */
export function buildEntry(
  name: string,
  sourceUrl: string,
  html: string,
  curatedAt: string = new Date().toISOString(),
): EnrichmentEntry {
  const parsed = parsePeptidePage(html);
  const { aliases } = libraryMeta(name);
  return {
    name,
    ...(aliases ? { aliases } : {}),
    benefits: parsed.benefits,
    sideEffects: parsed.sideEffects,
    dosingReference: parsed.dosingReference,
    reconstitution: parsed.reconstitution,
    reconstitutionRatio: parsed.reconstitutionRatio,
    mechanism: parsed.mechanism,
    templates: parsed.templates,
    references: parsed.references,
    source: ENRICHMENT_SOURCE,
    sourceUrl,
    attribution: ATTRIBUTION,
    curatedAt,
  };
}

/** True if the parsed entry carries enough signal to be worth keeping. */
export function entryHasSignal(entry: EnrichmentEntry): boolean {
  return (
    entry.benefits.length > 0 ||
    entry.sideEffects.length > 0 ||
    entry.dosingReference != null ||
    entry.templates.length > 0 ||
    entry.mechanism != null
  );
}

export interface ScrapeOneResult {
  name: string;
  status: "ok" | "skipped" | "failed";
  entry?: EnrichmentEntry;
  sourceUrl?: string;
  reason?: string;
}

/**
 * Scrape a single target: try each candidate slug until one fetches + parses
 * into a signal-bearing single-peptide entry. Per-target try/catch -- never
 * throws; returns a status so the caller can keep last-good data on failure.
 */
export async function scrapeTarget(
  target: SlugTarget,
  opts: { delayMs?: number; curatedAt?: string } = {},
): Promise<ScrapeOneResult> {
  const curatedAt = opts.curatedAt ?? new Date().toISOString();
  let lastReason = "no candidate slug succeeded";

  for (const slug of target.slugs) {
    const url = slugUrl(slug, target.base);
    try {
      const html = await fetchPage(url);
      // Single-peptide targets reject blend/stack pages; blend targets
      // (target.base set) expect them, so the guard is skipped there.
      if (target.base === undefined && isBlendOrStack(html, url)) {
        lastReason = "blend/stack page (skipped)";
        continue;
      }
      const entry = buildEntry(target.name, url, html, curatedAt);
      if (!entryHasSignal(entry)) {
        lastReason = "parsed but no extractable signal";
        continue;
      }
      return { name: target.name, status: "ok", entry, sourceUrl: url };
    } catch (err) {
      lastReason = err instanceof Error ? err.message : String(err);
    }
    if (opts.delayMs) await delay(opts.delayMs);
  }
  return { name: target.name, status: "failed", reason: lastReason };
}

/**
 * Scrape all targets with small concurrency + polite pacing. Resilient:
 * per-target failures are recorded, not thrown.
 */
export async function scrapeAll(
  opts: { concurrency?: number; delayMs?: number; targets?: SlugTarget[] } = {},
): Promise<{ entries: EnrichmentEntry[]; results: ScrapeOneResult[] }> {
  const targets = opts.targets ?? [...SLUG_MAP, ...BLEND_SLUG_MAP];
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const delayMs = opts.delayMs ?? 800;
  const curatedAt = new Date().toISOString();

  const results: ScrapeOneResult[] = [];
  const queue = [...targets];

  async function worker() {
    while (queue.length) {
      const target = queue.shift();
      if (!target) break;
      const r = await scrapeTarget(target, { delayMs, curatedAt });
      results.push(r);
      await delay(delayMs); // polite gap between requests
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // Preserve SLUG_MAP order for deterministic output.
  const order = new Map(targets.map((t, i) => [t.name, i]));
  results.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));

  const entries = results
    .filter((r) => r.status === "ok" && r.entry)
    .map((r) => r.entry as EnrichmentEntry);

  return { entries, results };
}
