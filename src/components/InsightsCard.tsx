import type { Insight } from "@/lib/insights";

interface Props {
  insights: Insight[];
}

/**
 * Cross-metric insights — descriptive, honest observations. The disclaimer at
 * the top is load-bearing: these are NOT causal claims. Empty state when there
 * isn't enough data to show anything past the min-sample guards.
 */
export function InsightsCard({ insights }: Props) {
  return (
    <div className="h-full rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
      <p className="mb-3 text-xs text-muted">
        Observational — not medical advice; correlation ≠ causation.
      </p>

      {insights.length === 0 ? (
        <p className="text-sm text-muted">Not enough data yet for insights.</p>
      ) : (
        <ul className="space-y-3">
          {insights.map((i) => (
            <li key={i.id} className="border-t border-line/10 pt-3 first:border-t-0 first:pt-0">
              <p className="text-sm font-medium">{i.title}</p>
              <p className="mt-0.5 text-sm text-muted">{i.detail}</p>
              {i.samples && (
                <p className="mt-0.5 text-[11px] tabular-nums text-muted">
                  n={i.samples.a} vs n={i.samples.b}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
