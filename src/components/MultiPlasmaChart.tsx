"use client";

import { useEffect, useMemo, useState } from "react";
import type { PlasmaPoint } from "@/lib/plasma";
import { splitSeriesAtNow } from "@/lib/plasma";
import { normalizeToPeak } from "@/lib/plasma-overlay";
import type { PeptidePlasma } from "@/lib/analytics";
import { assignPlasmaSeriesColors } from "@/lib/plasma-series-colors";

interface Props {
  plasmaByPeptide: PeptidePlasma[];
  now: Date;
  compactOnPhone?: boolean;
  design?: "pitstop" | "current";
  missedDoses?: Date[];
  peptidesWithoutHalfLife?: { peptideId: string; peptideName: string }[];
  enableRangeToggle?: boolean;
  defaultWindowDays?: 7 | 14 | 30;
}

const MISSED_RED = "rgb(var(--danger))";
const DAY_MS = 86_400_000;
const WIDTH = 600;
const HEIGHT_FULL = 180;
const HEIGHT_PHONE = 108;
const PAD = { top: 12, right: 12, bottom: 28, left: 8 };
const COLOR_STATE_KEY = "pitstop.plasma-colors.v1";
const COLOR_DISMISS_PREFIX = "pitstop.plasma-colors.dismissed.";

function toViewX(t: number, minT: number, maxT: number): number {
  const range = maxT - minT || 1;
  return PAD.left + ((t - minT) / range) * (WIDTH - PAD.left - PAD.right);
}

function fingerprint(lines: { peptideId: string; color: string }[]): string {
  return lines.map((ln) => `${ln.peptideId}:${ln.color}`).sort().join("|");
}

function startOfDayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function MultiPlasmaChart({
  plasmaByPeptide,
  now,
  compactOnPhone = false,
  design = "current",
  missedDoses = [],
  peptidesWithoutHalfLife = [],
  enableRangeToggle = false,
  defaultWindowDays = 30,
}: Props) {
  const [colorNotice, setColorNotice] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState<7 | 14 | 30>(defaultWindowDays);

  const nowMs = now.getTime();
  const minT = nowMs - windowDays * DAY_MS;
  const maxT = nowMs + windowDays * DAY_MS;

  const visible = useMemo(
    () =>
      plasmaByPeptide
        .filter((p) => p.series.length >= 2)
        .map((p) => ({
          ...p,
          series: p.series.filter((pt) => {
            const t = pt.t.getTime();
            return t >= minT && t <= maxT;
          }),
        }))
        .filter((p) => p.series.length >= 2),
    [plasmaByPeptide, minT, maxT],
  );

  const colorAssignments = useMemo(
    () =>
      assignPlasmaSeriesColors(
        visible.map((p) => ({
          peptideId: p.peptideId,
          peptideName: p.peptideName,
          stackIds: p.stackIds,
          familyKey: p.familyKey,
        })),
      ),
    [visible],
  );
  const colorByPeptide = useMemo(
    () => new Map(colorAssignments.map((a) => [a.peptideId, a.color])),
    [colorAssignments],
  );

  const lines = useMemo(() => {
    const chartNow = new Date(nowMs);
    return visible.map((p) => {
      const norm = normalizeToPeak(p.series);
      const { historical, forecast } = splitSeriesAtNow(norm, chartNow);
      const showForecast = p.hasProjection && forecast.length >= 2;
      const mean = norm.length ? norm.reduce((s, pt) => s + pt.level, 0) / norm.length : 0;
      return {
        peptideId: p.peptideId,
        peptideName: p.peptideName,
        color: colorByPeptide.get(p.peptideId) ?? "rgb(var(--accent))",
        mean,
        historicalSeg: showForecast ? historical : norm,
        forecastSeg: showForecast ? forecast : null,
      };
    });
  }, [visible, colorByPeptide, nowMs]);

  useEffect(() => {
    if (typeof window === "undefined" || lines.length === 0) return;
    const current = {
      ids: lines.map((ln) => ln.peptideId).sort(),
      mapping: Object.fromEntries(lines.map((ln) => [ln.peptideId, ln.color])),
      signature: fingerprint(lines),
    };
    const dismissed = window.localStorage.getItem(`${COLOR_DISMISS_PREFIX}${current.signature}`) === "1";
    try {
      const raw = window.localStorage.getItem(COLOR_STATE_KEY);
      const previous = raw ? JSON.parse(raw) as { ids?: string[]; mapping?: Record<string, string> } : null;
      const prevIds = new Set(previous?.ids ?? []);
      const added = current.ids.filter((id) => !prevIds.has(id));
      const changedShared = current.ids.filter((id) => prevIds.has(id) && previous?.mapping?.[id] && previous.mapping[id] !== current.mapping[id]);
      if (!dismissed && added.length > 0 && changedShared.length > 0) {
        const addedNames = lines.filter((ln) => added.includes(ln.peptideId)).map((ln) => ln.peptideName);
        setColorNotice(`Chart colours updated for contrast after adding ${addedNames.join(", ")}.`);
      } else {
        setColorNotice(null);
      }
    } catch {
      setColorNotice(null);
    }
    window.localStorage.setItem(COLOR_STATE_KEY, JSON.stringify(current));
  }, [lines]);

  if (visible.length === 0) {
    return <p className="text-sm text-muted">Not enough data to render curve.</p>;
  }

  const dismissNotice = () => {
    if (typeof window === "undefined") return;
    const signature = fingerprint(lines);
    window.localStorage.setItem(`${COLOR_DISMISS_PREFIX}${signature}`, "1");
    setColorNotice(null);
  };

  const drawOrder = [...lines].sort((a, b) => b.mean - a.mean);
  const nowX = Math.max(PAD.left, Math.min(WIDTH - PAD.right, toViewX(nowMs, minT, maxT)));

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const labelStart = fmt(new Date(minT));
  const labelEnd = fmt(new Date(maxT));

  const isPitstop = design === "pitstop";
  const missedX = isPitstop
    ? Array.from(
        new Set(
          missedDoses
            .map((d) => d.getTime())
            .filter((t) => t >= minT && t <= maxT)
            .map((t) => Number(toViewX(t, minT, maxT).toFixed(1))),
        ),
      )
    : [];

  const axisTicks =
    isPitstop && maxT > minT
      ? compactOnPhone
        ? (() => {
            const todayMs = startOfDayMs(now);
            const yesterdayMs = todayMs - DAY_MS;
            const tomorrowMs = todayMs + DAY_MS;
            const dayStart = todayMs - windowDays * DAY_MS;
            const dayEnd = todayMs + windowDays * DAY_MS;
            const ticks: number[] = [];
            for (let t = dayStart; t <= dayEnd; t += DAY_MS) ticks.push(t);
            return ticks.map((t) => ({
              x: toViewX(t, minT, maxT),
              label:
                t === yesterdayMs
                  ? "Yesterday"
                  : t === todayMs
                    ? "Today"
                    : t === tomorrowMs
                      ? "Tomorrow"
                      : fmt(new Date(t)),
            }));
          })()
        : [0.25, 0.5, 0.75].map((f) => {
            const t = minT + f * (maxT - minT);
            return { x: toViewX(t, minT, maxT), label: fmt(new Date(t)) };
          })
      : [];

  const renderSvg = (HEIGHT: number) => {
    const toViewY = (level: number) => PAD.top + (1 - level) * (HEIGHT - PAD.top - PAD.bottom);
    const toPath = (seg: PlasmaPoint[]) =>
      seg
        .map((pt, i) => {
          const x = toViewX(pt.t.getTime(), minT, maxT);
          const y = toViewY(pt.level);
          return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
    const bottomY = HEIGHT - PAD.bottom;
    return (
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-label="Combined plasma curves for all active peptides" className="w-full" style={{ height: "auto" }}>
        {axisTicks.map((tk, i) => (
          <line key={`grid-${i}`} x1={tk.x} y1={PAD.top} x2={tk.x} y2={bottomY} stroke="rgb(var(--muted))" strokeWidth="0.5" strokeOpacity="0.18" />
        ))}
        {drawOrder.map((ln) => (
          <g key={ln.peptideId}>
            <path d={toPath(ln.historicalSeg)} fill="none" stroke={ln.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            {ln.forecastSeg && <path d={toPath(ln.forecastSeg)} fill="none" stroke={ln.color} strokeWidth="1.5" strokeDasharray="4 3" strokeLinecap="round" strokeLinejoin="round" />}
          </g>
        ))}
        {missedX.map((x, i) => (
          <g key={`missed-${i}`}>
            <path d={`M${(x - 3).toFixed(1)},${PAD.top} L${(x + 3).toFixed(1)},${PAD.top} L${x.toFixed(1)},${(PAD.top + 4).toFixed(1)} Z`} fill={MISSED_RED} />
            <line x1={x} y1={PAD.top + 4} x2={x} y2={bottomY} stroke={MISSED_RED} strokeWidth="1.25" strokeLinecap="round" strokeDasharray="0.5 4" />
          </g>
        ))}
        {nowMs >= minT && nowMs <= maxT && (
          <>
            <line x1={nowX} y1={PAD.top} x2={nowX} y2={bottomY} stroke="rgb(var(--muted))" strokeWidth="1" strokeDasharray="3 3" />
            <text x={nowX + 3} y={PAD.top + 8} fontSize="9" fill="rgb(var(--muted))">now</text>
          </>
        )}
        <line x1={PAD.left} y1={bottomY} x2={WIDTH - PAD.right} y2={bottomY} stroke="rgb(var(--muted))" strokeWidth="0.5" strokeOpacity="0.4" />
        {!compactOnPhone && <text x={PAD.left} y={HEIGHT - 6} fontSize="9" fill="rgb(var(--muted))">{labelStart}</text>}
        {axisTicks.map((tk, i) => (
          <g key={`tick-${i}`}>
            <line x1={tk.x} y1={bottomY} x2={tk.x} y2={bottomY + 3} stroke="rgb(var(--muted))" strokeWidth="0.5" strokeOpacity="0.4" />
            <text x={tk.x} y={HEIGHT - 6} fontSize="9" fill="rgb(var(--muted))" textAnchor="middle">{tk.label}</text>
          </g>
        ))}
        {!compactOnPhone && <text x={WIDTH - PAD.right} y={HEIGHT - 6} fontSize="9" fill="rgb(var(--muted))" textAnchor="end">{labelEnd}</text>}
      </svg>
    );
  };

  const phoneHide = compactOnPhone ? " max-[640px]:hidden" : "";

  return (
    <div>
      <p className={`mb-1 text-xs font-medium text-muted${phoneHide}`}>Relative plasma level — each peptide scaled to its own peak</p>
      {colorNotice && (
        <div className="mb-2 flex items-start justify-between gap-2 rounded-control bg-bg px-2.5 py-2 text-[11px] text-muted ring-1 ring-line/15">
          <span>{colorNotice}</span>
          <button type="button" onClick={dismissNotice} className="shrink-0 font-medium text-accentStrong">Dismiss</button>
        </div>
      )}
      {compactOnPhone ? (
        <>
          <div className="max-[640px]:hidden">{renderSvg(HEIGHT_FULL)}</div>
          <div className="hidden max-[640px]:block">{renderSvg(HEIGHT_PHONE)}</div>
        </>
      ) : (
        renderSvg(HEIGHT_FULL)
      )}
      {enableRangeToggle && (
        <div className="mt-2 inline-flex rounded-control bg-bg p-1 ring-1 ring-line/15">
          {([14, 30] as const).map((days) => {
            const active = windowDays === days;
            return (
              <button
                key={days}
                type="button"
                onClick={() => setWindowDays(days)}
                className={`rounded-control px-2.5 py-1 text-[11px] font-medium transition ${
                  active ? "bg-accent text-black" : "text-muted hover:text-text"
                }`}
              >
                ±{days}d
              </button>
            );
          })}
        </div>
      )}
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted">
        {lines.map((ln) => (
          <li key={ln.peptideId} className="inline-flex items-center gap-1.5">
            <svg width="16" height="6" aria-hidden="true">
              <line x1="0" y1="3" x2="16" y2="3" stroke={ln.color} strokeWidth="2" />
            </svg>
            {ln.peptideName}
          </li>
        ))}
        {isPitstop && missedX.length > 0 && (
          <li className="inline-flex items-center gap-1.5">
            <svg width="16" height="6" aria-hidden="true">
              <line x1="0" y1="3" x2="16" y2="3" stroke={MISSED_RED} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="0.5 3" />
            </svg>
            Missed dose
          </li>
        )}
      </ul>
      <p className={`mt-1 text-[10px] text-muted${phoneHide}`}>solid = actual · dashed = forecast</p>
      {peptidesWithoutHalfLife.length > 0 && (
        // Without this, a peptide with no half-life is simply absent from the
        // chart — indistinguishable from one you aren't taking. Name them.
        <p className="mt-1 text-[10px] text-muted">
          No curve for {peptidesWithoutHalfLife.map((p) => p.peptideName).join(", ")}
          {" "}— set a half-life in Settings.
        </p>
      )}
      <p className={`mt-1 text-[10px] text-muted${phoneHide}`}>Half-life estimate only — not a measured concentration. Not medical advice.</p>
    </div>
  );
}
