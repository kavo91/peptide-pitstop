"use client";

import { Pencil, Save, X, Plus, Info, Search } from "lucide-react";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { savePeptide, addPeptideFromLibrary, deletePeptide, type PeptideInput } from "@/app/actions/peptides";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import type { LibraryPeptide } from "@/lib/peptide-library";
import type { NeutralReferenceEntry } from "@/lib/compliance";
import { PeptideLibraryDetail } from "./PeptideLibraryDetail";
import { BlendComponentsEditor, type BlendComponentRow } from "./BlendComponentsEditor";

interface Peptide extends Required<Omit<PeptideInput, "id">> {
  id: string;
  /** True for the user's own peptides; false for shared-library rows (userId: null).
   *  Shared rows can't be edited or deleted (the server actions refuse), so the UI
   *  hides those controls for them. */
  owned: boolean;
  /** Reference enrichment (peptidedosages.com) — null when none is curated. */
  enrichment?: NeutralReferenceEntry | null;
}

interface LibraryEntry extends LibraryPeptide {
  enrichment?: NeutralReferenceEntry | null;
}

const BLANK: PeptideInput = {
  name: "",
  aliases: "",
  category: "",
  substanceClass: "mass",
  defaultStrengthMg: "",
  halfLifeHours: "",
  minIntervalHours: "",
  missedDosePolicy: "prompt",
  storageNotes: "",
  route: "injection",
};

const input = "w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink";

export function PeptideManager({ peptides, library = [], blendComponents = {} }: { peptides: Peptide[]; library?: LibraryEntry[]; blendComponents?: Record<string, BlendComponentRow[]> }) {
  const [openBlend, setOpenBlend] = useState<Set<string>>(new Set());
  const componentCandidates = peptides.map((x) => ({ id: x.id, name: x.name }));
  const router = useRouter();
  const [form, setForm] = useState<PeptideInput | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which rows have their reference-detail panel expanded (keyed by id / name).
  const [openOwned, setOpenOwned] = useState<Set<string>>(new Set());
  const [openLibrary, setOpenLibrary] = useState<Set<string>>(new Set());

  function toggle(setter: typeof setOpenOwned, key: string) {
    setter((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }

  function set<K extends keyof PeptideInput>(k: K, v: PeptideInput[K]) {
    setForm((f) => ({ ...(f ?? BLANK), [k]: v }));
  }

  // Case-insensitive filter over name / aliases / category.
  const filteredLibrary = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return library;
    return library.filter((e) =>
      [e.name, e.aliases ?? "", e.category ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [library, query]);

  /** Add reference data only; protocols are always entered manually/by prescriber. */
  async function addFromLibrary(e: LibraryEntry) {
    setBusy(true);
    setError(null);
    const res = await addPeptideFromLibrary({
      name: e.name,
      aliases: e.aliases ?? "",
      category: e.category,
      substanceClass: e.substanceClass,
      halfLifeHours: e.halfLifeHours ?? "",
      storageNotes: e.storageNotes ?? "",
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    const res = await savePeptide(form);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setForm(null);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {peptides.map((p) => {
          return (
          <li key={p.id} className="rounded-card bg-surface px-4 py-3 text-sm shadow-sm ring-1 ring-line/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted">
                  {p.route === "oral" ? "Oral" : "Injection"}
                  {` · ${p.substanceClass}`}
                  {p.halfLifeHours && ` · t½ ${p.halfLifeHours}h`}
                  {p.defaultStrengthMg && ` · ${p.defaultStrengthMg} mg`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {p.enrichment && (
                  <button type="button" onClick={() => toggle(setOpenOwned, p.id)} className="inline-flex items-center gap-1 text-xs font-medium text-accentStrong" aria-expanded={openOwned.has(p.id)}>
                    <Info className="h-3.5 w-3.5" aria-hidden /> {openOwned.has(p.id) ? "Hide" : "Details"}
                  </button>
                )}
                {p.owned ? (
                  <>
                    <button type="button" onClick={() => setForm({ id: p.id, name: p.name, aliases: p.aliases, category: p.category, substanceClass: p.substanceClass, defaultStrengthMg: p.defaultStrengthMg, halfLifeHours: p.halfLifeHours, minIntervalHours: p.minIntervalHours, missedDosePolicy: p.missedDosePolicy, storageNotes: p.storageNotes, route: p.route })} className="inline-flex items-center gap-1 text-xs font-medium text-accentStrong"><Pencil className="h-3.5 w-3.5" aria-hidden /> Edit</button>
                    <button type="button" onClick={() => toggle(setOpenBlend, p.id)} className="inline-flex items-center gap-1 text-xs font-medium text-accentStrong" aria-expanded={openBlend.has(p.id)}>Blend{(blendComponents[p.id]?.length ?? 0) > 0 ? ` (${blendComponents[p.id].length})` : ""}</button>
                    <ConfirmDeleteButton action={deletePeptide} id={p.id} confirmMessage={`Delete ${p.name}? It must have no vials, protocols, or prescriptions, and not be a component of any blend.`} compact ariaLabel={`Delete ${p.name}`} />
                  </>
                ) : (
                  <span className="text-xs text-muted">Library</span>
                )}
              </div>
            </div>
            {p.enrichment && openOwned.has(p.id) && (
              <PeptideLibraryDetail entry={p.enrichment} />
            )}
            {p.owned && openBlend.has(p.id) && (
              <BlendComponentsEditor
                peptideId={p.id}
                peptideName={p.name}
                defaultStrengthMg={p.defaultStrengthMg ? Number(p.defaultStrengthMg) : null}
                initial={blendComponents[p.id] ?? []}
                candidates={componentCandidates}
              />
            )}
          </li>
          );
        })}
      </ul>

      {form ? (
        <div className="space-y-2 rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
          <p className="text-sm font-medium">{form.id ? "Edit peptide" : "New peptide"}</p>
          <input className={input} placeholder="Name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <input className={input} placeholder="Aliases (comma-separated)" value={form.aliases} onChange={(e) => set("aliases", e.target.value)} />
          <div className="flex gap-2">
            <select className={input} value={form.route ?? "injection"} onChange={(e) => set("route", e.target.value)} aria-label="Route">
              <option value="injection">Injection</option>
              <option value="oral">Oral</option>
            </select>
            <select className={input} value={form.substanceClass} onChange={(e) => set("substanceClass", e.target.value)} aria-label="Substance class">
              <option value="mass">mass</option>
              <option value="IU">IU</option>
            </select>
            <select className={input} value={form.missedDosePolicy} onChange={(e) => set("missedDosePolicy", e.target.value)} aria-label="Missed dose policy">
              <option value="prompt">prompt</option>
              <option value="skip">skip</option>
              <option value="take_now">take now</option>
            </select>
          </div>
          <div className="flex gap-2">
            <input className={input} inputMode="decimal" placeholder="Strength mg" value={form.defaultStrengthMg} onChange={(e) => set("defaultStrengthMg", e.target.value)} />
            <input className={input} inputMode="decimal" placeholder="Half-life h" value={form.halfLifeHours} onChange={(e) => set("halfLifeHours", e.target.value)} />
            <input className={input} inputMode="decimal" placeholder="Min interval h" value={form.minIntervalHours} onChange={(e) => set("minIntervalHours", e.target.value)} />
          </div>
          <input className={input} placeholder="Storage notes" value={form.storageNotes} onChange={(e) => set("storageNotes", e.target.value)} />
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy} className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-accent px-4 py-2 text-sm font-medium text-onAccent disabled:opacity-40">{busy ? "…" : <><Save className="h-4 w-4" aria-hidden /> Save</>}</button>
            <button type="button" onClick={() => { setForm(null); setError(null); }} className="inline-flex items-center gap-1.5 rounded-control bg-bg px-4 py-2 text-sm ring-1 ring-line/15"><X className="h-4 w-4" aria-hidden /> Cancel</button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {library.length > 0 && (
            <button type="button" onClick={() => setShowLibrary((s) => !s)} className="w-full rounded-control bg-bg px-4 py-2 text-sm font-medium text-accentStrong ring-1 ring-line/15">
              {showLibrary ? "Hide library" : "+ Add from library"}
            </button>
          )}
          {showLibrary && (
            <ul className="space-y-1.5 rounded-card bg-surface p-3 shadow-sm ring-1 ring-line/10">
              <li className="px-1 pb-1 text-xs text-muted">Common research peptides — reference data, not medical advice.</li>
              <li>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                  <input
                    className={`${input} pl-8`}
                    type="search"
                    placeholder="Search peptides…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search the peptide library"
                  />
                </div>
              </li>
              {filteredLibrary.length === 0 && (
                <li className="px-1 py-2 text-xs text-muted">No peptides match “{query}”.</li>
              )}
              {filteredLibrary.map((e) => {
                return (
                <li key={e.name} className="rounded-control bg-bg px-3 py-2 text-sm ring-1 ring-line/10">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{e.name}</p>
                      <p className="text-xs text-muted tabular-nums">
                        {e.category} · {e.substanceClass}
                        {e.halfLifeHours && ` · t½ ${e.halfLifeHours}h`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {e.enrichment && (
                        <button type="button" onClick={() => toggle(setOpenLibrary, e.name)} className="inline-flex items-center gap-1 text-xs font-medium text-accentStrong" aria-expanded={openLibrary.has(e.name)}>
                          <Info className="h-3.5 w-3.5" aria-hidden /> {openLibrary.has(e.name) ? "Hide" : "Details"}
                        </button>
                      )}
                      <button type="button" onClick={() => addFromLibrary(e)} disabled={busy} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accentStrong disabled:opacity-40"><Plus className="h-3.5 w-3.5" aria-hidden /> Add</button>
                    </div>
                  </div>
                  {e.enrichment && openLibrary.has(e.name) && (
                    <PeptideLibraryDetail entry={e.enrichment} />
                  )}
                </li>
                );
              })}
            </ul>
          )}
          <button type="button" onClick={() => setForm({ ...BLANK })} className="flex w-full items-center justify-center gap-1.5 rounded-control bg-bg px-4 py-2 text-sm font-medium text-accentStrong ring-1 ring-line/15"><Plus className="h-4 w-4" aria-hidden /> Add custom peptide</button>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
