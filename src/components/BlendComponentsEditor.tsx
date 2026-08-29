"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2 } from "lucide-react";
import { saveBlendComponents } from "@/app/actions/blend-components";
import { blendMassCheck, type BlendComponent } from "@/lib/blends-core";

export interface BlendComponentRow {
  componentPeptideId: string;
  massMg: string;
  source: string;
}

/**
 * Edits the composition of ONE vial of blended powder.
 *
 * Masses are per labelled vial (KLOW: 50/10/10/10 in an 80 mg vial). The sum is
 * checked against the vial's declared strength as a WARNING only — a mis-set
 * defaultStrengthMg must never block a user from editing their own blend.
 */
export function BlendComponentsEditor({
  peptideId,
  peptideName,
  defaultStrengthMg,
  initial,
  candidates,
}: {
  peptideId: string;
  peptideName: string;
  defaultStrengthMg: number | null;
  initial: BlendComponentRow[];
  candidates: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<BlendComponentRow[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [serverWarning, setServerWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nameById = useMemo(
    () => new Map(candidates.map((c) => [c.id, c.name])),
    [candidates],
  );

  const asComponents: BlendComponent[] = rows
    .filter((r) => r.componentPeptideId && Number(r.massMg) > 0)
    .map((r, i) => ({
      componentPeptideId: r.componentPeptideId,
      componentName: nameById.get(r.componentPeptideId) ?? "?",
      massMg: Number(r.massMg),
      source: (r.source as BlendComponent["source"]) ?? "label",
      sortIndex: i,
    }));

  const check = blendMassCheck(asComponents, defaultStrengthMg);
  const totalMg = check.sumMg;

  function update(i: number, patch: Partial<BlendComponentRow>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await saveBlendComponents({
      peptideId,
      components: rows
        .filter((r) => r.componentPeptideId)
        .map((r, i) => ({ ...r, sortIndex: i })),
    });
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    setServerWarning("warning" in res ? res.warning : null);
    router.refresh();
  }

  return (
    <div className="mt-3 rounded-card bg-surfaceMuted p-3 text-sm ring-1 ring-line/10">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
        Blend components — {peptideName}
      </p>

      {rows.length === 0 && (
        <p className="mb-2 text-xs text-muted">
          Not a blend. Add components only for one vial containing several peptides.
        </p>
      )}

      <ul className="space-y-2">
        {rows.map((r, i) => {
          const pct = totalMg > 0 && Number(r.massMg) > 0
            ? ((Number(r.massMg) / totalMg) * 100).toFixed(1)
            : null;
          return (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Component peptide"
                className="min-w-[10rem] rounded border border-line/30 bg-surface px-2 py-1"
                value={r.componentPeptideId}
                onChange={(e) => update(i, { componentPeptideId: e.target.value })}
              >
                <option value="">— choose —</option>
                {candidates.filter((c) => c.id !== peptideId).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input
                aria-label="Mass mg"
                inputMode="decimal"
                className="w-20 rounded border border-line/30 bg-surface px-2 py-1"
                value={r.massMg}
                onChange={(e) => update(i, { massMg: e.target.value })}
                placeholder="mg"
              />
              <select
                aria-label="Ratio source"
                className="rounded border border-line/30 bg-surface px-2 py-1"
                value={r.source}
                onChange={(e) => update(i, { source: e.target.value })}
              >
                <option value="label">label</option>
                <option value="coa">coa</option>
                <option value="assumed">assumed</option>
              </select>
              {pct && <span className="text-xs text-muted">{pct}%</span>}
              <button
                type="button"
                aria-label="Remove component"
                onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                className="text-muted hover:text-danger"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, { componentPeptideId: "", massMg: "", source: "label" }])}
          className="inline-flex items-center gap-1 text-xs font-medium text-accentStrong"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add component
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1 text-xs font-medium text-accentStrong disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" aria-hidden /> {saving ? "Saving…" : "Save components"}
        </button>
        {rows.length > 0 && <span className="text-xs text-muted">total {totalMg} mg</span>}
      </div>

      {asComponents.length > 0 && !check.ok && (
        <p className="mt-2 text-xs text-warning">
          Components total {check.sumMg} mg, vial label says {check.expectedMg} mg. Saved either way —
          check whichever is wrong.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {serverWarning && <p className="mt-2 text-xs text-warning">{serverWarning}</p>}
      {rows.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          Component masses are per labelled vial. Everything derived from them is shown as derived,
          never as a measured dose.
        </p>
      )}
    </div>
  );
}
