import type { BlendStepBreakdownData } from "@/lib/blend-step-breakdown";

/**
 * Doctor-readable table: how each blend component's per-injection mass moves
 * across the titration ladder. Server-rendered, read-only. Derived masses —
 * the caption names the ratio source so they can't pass as measured values.
 */
export function BlendStepBreakdown({ data, peptideName }: { data: BlendStepBreakdownData; peptideName: string }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-card bg-surface p-3 ring-1 ring-line/10">
      <p className="mb-2 text-xs font-medium">Per-component breakdown</p>
      <table className="w-full whitespace-nowrap text-xs tabular-nums">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-1 pr-3 font-normal">Step</th>
            <th className="py-1 pr-3 font-normal">Blend dose</th>
            {data.componentNames.map((n) => (
              <th key={n} className="py-1 pr-3 font-normal">{n}</th>
            ))}
            <th className="py-1 font-normal">Duration</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.stepIndex} className="border-t border-line/10">
              <td className="py-1 pr-3 text-muted">{r.stepIndex + 1}</td>
              <td className="py-1 pr-3">{r.stepLabel}</td>
              {r.componentMcg.map((m, i) => (
                <td key={i} className="py-1 pr-3">{m == null ? "—" : `${m} mcg`}</td>
              ))}
              <td className="py-1 text-muted">{r.durationDays == null ? "maintenance" : `${r.durationDays} d`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted">
        Component masses are derived from the {peptideName} vendor ratio ({data.source}); the blend is one vial —
        components are not dosed separately.
      </p>
    </div>
  );
}
