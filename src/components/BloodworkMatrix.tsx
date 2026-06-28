/**
 * Pitstop-only bloodwork comparison matrix — a biomarker × (last 3 panels,
 * newest-first) table styled as a race telemetry sheet. Presentational and
 * read-only: it receives already-decoded panel data from the server page and
 * derives nothing but display state (out-of-range flags + improved-vs-prior
 * arrows). Rendered ONLY when the pitstop design is active.
 *
 * Reference only — not medical advice.
 */
import { parseNumeric, type Flag } from "@/lib/bloodwork";

/** A single decoded result row as the bloodwork page assembles it. */
export interface MatrixResult {
  biomarkerName: string;
  value: string;
  unit: string;
  referenceLow: number | null;
  referenceHigh: number | null;
  flag: Flag | string | null;
}

export interface MatrixPanel {
  id: string;
  collectedDate: Date;
  results: MatrixResult[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Two-digit zero-padded helper for the MM·DD column headers. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Column header label "MM·DD" (locale-independent — avoids hydration drift). */
function colLabel(d: Date): string {
  return `${pad2(d.getMonth() + 1)}·${pad2(d.getDate())}`;
}

/** Caption date label "YYYY-MM-DD" (locale-independent). */
function captionDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Whether a flag means the value is outside the lab reference interval. */
function outOfRange(flag: Flag | string | null): "high" | "low" | null {
  if (flag === "high") return "high";
  if (flag === "low") return "low";
  return null;
}

/** Signed distance outside the reference interval; 0 if inside / unbounded. */
function distanceOutside(n: number, low: number | null, high: number | null): number {
  if (low != null && n < low) return low - n;
  if (high != null && n > high) return n - high;
  return 0;
}

export function BloodworkMatrix({ panels }: { panels: MatrixPanel[] }) {
  if (panels.length === 0) return null;

  // Last 3 panels, newest-first. Page already supplies date-desc, but slice
  // defensively in case the caller passes the full history.
  const cols = panels.slice(0, 3);

  // Collect every biomarker that appears across the shown panels, preserving a
  // stable alphabetical order for the rows.
  const names = new Set<string>();
  for (const p of cols) for (const r of p.results) names.add(r.biomarkerName);
  const rowNames = [...names].sort((a, b) => a.localeCompare(b));

  // Fast lookup: panel index → (name → result).
  const byPanel = cols.map((p) => {
    const m = new Map<string, MatrixResult>();
    for (const r of p.results) if (!m.has(r.biomarkerName)) m.set(r.biomarkerName, r);
    return m;
  });

  // Per-biomarker meta (unit + ref) taken from the most recent panel that has it.
  function metaFor(name: string): { unit: string; ref: string } {
    for (const m of byPanel) {
      const r = m.get(name);
      if (!r) continue;
      const ref =
        r.referenceLow != null || r.referenceHigh != null
          ? `${r.referenceLow ?? ""}–${r.referenceHigh ?? ""}`
          : "—";
      return { unit: r.unit || "—", ref };
    }
    return { unit: "—", ref: "—" };
  }

  return (
    <section className="mb-8">
      <div className="pitstop-slash-edge rounded-card bg-surface p-3 shadow-sm ring-1 ring-line/10">
        <table className="pitstop-bw">
          <thead>
            <tr>
              <th className="l">Analyte</th>
              <th>Unit</th>
              <th>Ref</th>
              {cols.map((p, ci) => (
                <th key={p.id} className={ci === 0 ? "latest-col" : undefined}>
                  {colLabel(p.collectedDate)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowNames.map((name) => {
              const meta = metaFor(name);
              return (
                <tr key={name}>
                  <td className="l">
                    <span className="analyte">{name}</span>
                  </td>
                  <td className="ref">{meta.unit}</td>
                  <td className="ref">{meta.ref}</td>
                  {cols.map((p, ci) => {
                    const r = byPanel[ci].get(name);
                    if (!r) {
                      return (
                        <td key={p.id} className={ci === 0 ? "latest-col latest-cell" : undefined}>
                          —
                        </td>
                      );
                    }

                    const oor = outOfRange(r.flag);

                    // "Improved vs prior" only applies to the newest column and
                    // needs a numeric prior reading for the same biomarker.
                    let improved: "up" | "down" | null = null;
                    if (ci === 0) {
                      const prior = byPanel[1]?.get(name);
                      const now = parseNumeric(r.value);
                      const pn = prior ? parseNumeric(prior.value) : null;
                      if (now != null && pn != null) {
                        const low = r.referenceLow ?? prior?.referenceLow ?? null;
                        const high = r.referenceHigh ?? prior?.referenceHigh ?? null;
                        const nowDist = distanceOutside(now, low, high);
                        const priorDist = distanceOutside(pn, low, high);
                        if (nowDist < priorDist) improved = now >= pn ? "up" : "down";
                      }
                    }

                    const cls = [
                      ci === 0 ? "latest-col latest-cell" : "",
                      improved ? "bw-imp" : "",
                    ]
                      .filter(Boolean)
                      .join(" ");

                    // Out-of-range values wrap in a coloured span + a (H)/(L) flag.
                    const valueNode = oor ? (
                      <>
                        <span className={oor === "high" ? "bw-hi" : "bw-lo"}>{r.value}</span>{" "}
                        <span className="bw-flag">({oor === "high" ? "H" : "L"})</span>
                      </>
                    ) : (
                      r.value
                    );

                    return (
                      <td key={p.id} className={cls || undefined}>
                        {valueNode}
                        {improved && (
                          <span className="bw-trend">{improved === "up" ? "▲" : "▼"}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 font-mono text-[10px] tracking-[0.04em] text-muted">
        {cols
          .map((p, i) => `${i === 0 ? "Latest" : i === 1 ? "prior" : "base"} ${captionDate(p.collectedDate)}`)
          .join(" · ")}
      </p>
    </section>
  );
}
