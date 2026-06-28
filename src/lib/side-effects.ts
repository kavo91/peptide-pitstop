/**
 * Structured side-effects — pure helpers, NO I/O, no crypto. The `JournalEntry.sideEffects`
 * column stores an ENCRYPTED JSON payload; this module owns the on-disk shape and the
 * back-compat read path. The caller encrypts the serialized string and decrypts before
 * deserializing.
 *
 * WRITE shape (current): JSON array of objects `[{symptom, severity}]`.
 * READ shape (back-compat, accepted on the way in):
 *   (a) new object array      → used as-is
 *   (b) legacy `string[]`     → `{symptom, severity: null}`
 *   (c) legacy bare plaintext → single `{symptom, severity: null}`
 * Malformed input NEVER throws — it returns `[]`.
 */

export type Severity = "mild" | "moderate" | "severe";

export interface SideEffectEntry {
  symptom: string;
  severity: Severity | null;
}

const SEVERITIES: readonly Severity[] = ["mild", "moderate", "severe"];

/** Curated, peptide-relevant default symptoms. Overridden per-user by `User.symptomList`. */
export const DEFAULT_SYMPTOMS: readonly string[] = [
  "Injection-site reaction",
  "Nausea",
  "Headache",
  "Fatigue",
  "Flushing",
  "Water retention",
  "Appetite change",
  "GI upset",
  "Dizziness",
  "Tingling/numbness",
  "Irritability",
  "Sleep disturbance",
];

function isSeverity(v: unknown): v is Severity {
  return typeof v === "string" && (SEVERITIES as readonly string[]).includes(v);
}

/** Resolve the active symptom list for a user: their JSON override, or the curated default. */
export function resolveSymptomList(symptomListJson: string | null | undefined): readonly string[] {
  if (!symptomListJson) return DEFAULT_SYMPTOMS;
  try {
    const parsed: unknown = JSON.parse(symptomListJson);
    if (Array.isArray(parsed)) {
      const names = parsed.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
      if (names.length) return names;
    }
  } catch {
    /* fall through to default */
  }
  return DEFAULT_SYMPTOMS;
}

/**
 * Parse a free-text/newline/comma symptom list into a JSON array string for `User.symptomList`.
 * Returns null when empty (→ clears the override, falling back to the curated default).
 */
export function serializeSymptomList(text: string | null | undefined): string | null {
  if (!text) return null;
  const names = text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // De-dupe case-insensitively, keep first-seen casing.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const k = n.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(n);
    }
  }
  return out.length ? JSON.stringify(out) : null;
}

/** Normalise one loosely-typed item into a SideEffectEntry, or null if unusable. */
function coerceEntry(item: unknown): SideEffectEntry | null {
  if (typeof item === "string") {
    const symptom = item.trim();
    return symptom ? { symptom, severity: null } : null;
  }
  if (item && typeof item === "object") {
    const rec = item as Record<string, unknown>;
    const symptom = typeof rec.symptom === "string" ? rec.symptom.trim() : "";
    if (!symptom) return null;
    return { symptom, severity: isSeverity(rec.severity) ? rec.severity : null };
  }
  return null;
}

/**
 * Serialize structured side effects into a JSON array string for storage (the caller
 * encrypts the result). Drops entries with a blank symptom; returns null when empty.
 * Pure — does NOT encrypt.
 */
export function serializeSideEffects(entries: SideEffectEntry[] | null | undefined): string | null {
  if (!entries || !entries.length) return null;
  const clean = entries
    .map((e) => coerceEntry(e))
    .filter((e): e is SideEffectEntry => e != null);
  return clean.length ? JSON.stringify(clean) : null;
}

/**
 * Parse a (decrypted) stored value into structured entries. Accepts the new object
 * array, a legacy string array, or legacy bare plaintext. NEVER throws — malformed
 * input returns `[]`.
 */
export function deserializeSideEffects(raw: string | null | undefined): SideEffectEntry[] {
  if (raw == null) return [];
  const text = raw.trim();
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map(coerceEntry).filter((e): e is SideEffectEntry => e != null);
    }
    if (typeof parsed === "string") {
      const symptom = parsed.trim();
      return symptom ? [{ symptom, severity: null }] : [];
    }
    // Some other JSON scalar/object — not a recognised shape.
    return [];
  } catch {
    // Not JSON — legacy bare plaintext.
    return [{ symptom: text, severity: null }];
  }
}

/** Render one entry: "Nausea (moderate)" with severity, else "Nausea". */
export function formatSideEffectEntry(e: SideEffectEntry): string {
  return e.severity ? `${e.symptom} (${e.severity})` : e.symptom;
}

/**
 * Render a (decrypted) side-effects value for display as a comma-joined string.
 * Back-compat over all stored shapes; returns "" when empty. Severity is shown
 * in parentheses when present.
 */
export function formatSideEffects(decrypted: string | null | undefined): string {
  return deserializeSideEffects(decrypted).map(formatSideEffectEntry).join(", ");
}
