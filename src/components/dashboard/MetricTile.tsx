/**
 * Generic metric tile for the Dashboard — shows a label, a numeric value,
 * and an optional link target. Used for Adherence % and Protocol day.
 *
 * Two design packs render off one component:
 *   - current (default neon): byte-identical to the original render.
 *   - pitstop: telemetry stat tile — big mono value with a smaller muted unit,
 *     a sub-line, a colour-coded delta line pinned to the bottom, and a 3px
 *     bottom accent bar. The `design`/`delta` props only affect the pitstop
 *     branch; without them the pitstop branch still renders (sans delta).
 */
import Link from "next/link";

type DeltaTone = "up" | "best" | "hold" | "down";

interface Delta {
  text: string;
  tone: DeltaTone;
}

interface Props {
  label: string;
  value: string;
  sub?: string;
  href?: string;
  design?: "pitstop" | "current";
  delta?: Delta;
}

// Sector-best purple is a literal hex (no design token).
const PURPLE = "#B14EFF";

/** Tailwind text colour class for a delta tone (best handled inline via style). */
function deltaTextClass(tone: DeltaTone): string {
  switch (tone) {
    case "up":
      return "text-ok";
    case "hold":
      return "text-accent";
    case "down":
      return "text-danger";
    case "best":
      return ""; // purple applied via inline style
  }
}

/** Tailwind bg class for the bottom accent bar by tone (best via inline style). */
function barClass(tone: DeltaTone): string {
  switch (tone) {
    case "up":
      return "bg-ok";
    case "hold":
      return "bg-accent";
    case "down":
      return "bg-danger";
    case "best":
      return ""; // purple applied via inline style
  }
}

export function MetricTile({ label, value, sub, href, design, delta }: Props) {
  const pit = design === "pitstop";

  if (pit) {
    // Split a trailing "%" or "d" unit into a smaller muted <small>.
    const unitMatch = /[%d]$/.test(value) ? value.slice(-1) : null;
    const numPart = unitMatch ? value.slice(0, -1) : value;

    const barStyle =
      delta?.tone === "best" ? { backgroundColor: PURPLE } : undefined;
    const barCls = delta ? barClass(delta.tone) : "bg-line/30";

    const inner = (
      <div className="relative flex h-full flex-col gap-1 overflow-hidden rounded-card bg-surface p-4 ring-1 ring-line/10 shadow-sm">
        <p className="text-xs font-medium text-muted">{label}</p>
        <p className="font-mono text-2xl font-semibold tabular-nums text-ink">
          {numPart}
          {unitMatch && (
            <small className="ml-0.5 text-base font-medium text-muted">{unitMatch}</small>
          )}
        </p>
        {sub && <p className="text-xs text-muted">{sub}</p>}
        {delta && (
          <p
            className={`mt-auto font-mono text-[11px] font-semibold ${deltaTextClass(delta.tone)}`}
            style={delta.tone === "best" ? { color: PURPLE } : undefined}
          >
            {delta.text}
          </p>
        )}
        <span
          className={`absolute inset-x-0 bottom-0 h-[3px] ${barCls}`}
          style={barStyle}
        />
      </div>
    );
    if (href) {
      return <Link href={href} className="block h-full">{inner}</Link>;
    }
    return inner;
  }

  // current design — unchanged.
  const inner = (
    <div className="flex h-full flex-col gap-1 rounded-card bg-surface p-4 ring-1 ring-line/10 shadow-sm">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="font-mono text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
  if (href) {
    return <Link href={href} className="block h-full">{inner}</Link>;
  }
  return inner;
}
