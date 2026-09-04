"use client";

import { useState, useId } from "react";
import { SITE_OPTIONS, suggestNextSite, zoneView, recencyRank } from "@/lib/sites";
import { BACK_LINES, BODY_OUTLINE, FRONT_LINES, HEAD_ELLIPSE, SILHOUETTE_VIEWBOX } from "@/lib/body-silhouette";

interface BodyMapProps {
  value: string | null;
  onChange: (code: string) => void;
  recentSites: string[];
  recencyDaysByCode?: Record<string, number>;
  /** Active design pack — threaded from the form. Gates pitstop presentation. */
  design?: "pitstop" | "current";
}

// Silhouette geometry lives in @/lib/body-silhouette (shared with the DEXA figure).
// Front zones: abdomen_L/R, delt_L/R, thigh_L/R, ventro_L/R, love_handle_L/R. Back zones: glute_L/R.

function Silhouette({ view }: { view: "front" | "back" }) {
  const lines = view === "front" ? FRONT_LINES : BACK_LINES;
  return (
    <g>
      <ellipse {...HEAD_ELLIPSE} className="fill-surface stroke-muted/40" strokeWidth={1.2} />
      {BODY_OUTLINE.map((d, i) => (
        <path key={i} d={d} className="fill-surface stroke-muted/40" strokeWidth={1.2} strokeLinejoin="round" />
      ))}
      {lines.map((d, i) => (
        <path key={`l-${i}`} d={d} fill="none" className="stroke-muted/30" strokeWidth={0.8} strokeLinecap="round" />
      ))}
    </g>
  );
}

// Zone hit-area paths — approximate muscle belly centroids on the silhouette.
// These are elliptical hit-areas placed over the muscle group.
// Coordinates are in the 180×320 viewBox.
const ZONE_PATHS: Record<string, { view: "front" | "back"; d: string; labelX: number; labelY: number }> = {
  abdomen_L: {
    view: "front",
    d: "M 60 130 C 55 130 52 135 52 142 C 52 149 55 154 60 154 C 72 154 80 149 80 142 C 80 135 72 130 60 130 Z",
    labelX: 66, labelY: 143,
  },
  abdomen_R: {
    view: "front",
    d: "M 120 130 C 108 130 100 135 100 142 C 100 149 108 154 120 154 C 125 154 128 149 128 142 C 128 135 125 130 120 130 Z",
    labelX: 114, labelY: 143,
  },
  delt_L: {
    view: "front",
    d: "M 43 72 C 37 72 33 76 33 82 C 33 88 37 93 43 93 C 49 93 54 88 54 82 C 54 76 49 72 43 72 Z",
    labelX: 43, labelY: 83,
  },
  delt_R: {
    view: "front",
    d: "M 137 72 C 131 72 126 76 126 82 C 126 88 131 93 137 93 C 143 93 147 88 147 82 C 147 76 143 72 137 72 Z",
    labelX: 137, labelY: 83,
  },
  thigh_L: {
    view: "front",
    d: "M 62 190 C 52 190 46 197 46 207 C 46 217 52 224 62 224 C 72 224 78 217 78 207 C 78 197 72 190 62 190 Z",
    labelX: 62, labelY: 208,
  },
  thigh_R: {
    view: "front",
    d: "M 118 190 C 108 190 102 197 102 207 C 102 217 108 224 118 224 C 128 224 134 217 134 207 C 134 197 128 190 118 190 Z",
    labelX: 118, labelY: 208,
  },
  ventro_L: {
    view: "front",
    d: "M 48 158 C 40 158 36 163 36 170 C 36 177 40 182 48 182 C 56 182 60 177 60 170 C 60 163 56 158 48 158 Z",
    labelX: 48, labelY: 171,
  },
  ventro_R: {
    view: "front",
    d: "M 132 158 C 124 158 120 163 120 170 C 120 177 124 182 132 182 C 140 182 144 177 144 170 C 144 163 140 158 132 158 Z",
    labelX: 132, labelY: 171,
  },
  love_handle_L: {
    view: "front",
    d: "M 44 132 C 36 132 32 138 32 146 C 32 154 36 160 44 160 C 50 160 54 154 54 146 C 54 138 50 132 44 132 Z",
    labelX: 44, labelY: 147,
  },
  love_handle_R: {
    view: "front",
    d: "M 136 132 C 128 132 124 138 124 146 C 124 154 128 160 136 160 C 142 160 146 154 146 146 C 146 138 142 132 136 132 Z",
    labelX: 136, labelY: 147,
  },
  glute_L: {
    view: "back",
    d: "M 62 175 C 50 175 42 183 42 193 C 42 203 50 212 62 212 C 74 212 82 203 82 193 C 82 183 74 175 62 175 Z",
    labelX: 62, labelY: 194,
  },
  glute_R: {
    view: "back",
    d: "M 118 175 C 106 175 98 183 98 193 C 98 203 106 212 118 212 C 130 212 138 203 138 193 C 138 183 130 175 118 175 Z",
    labelX: 118, labelY: 194,
  },
};

type ZoneState = "selected" | "suggested" | "recent" | "available";

function getZoneState(
  code: string,
  value: string | null,
  suggestedCode: string,
  rankMap: Map<string, number>
): ZoneState {
  if (value === code) return "selected";
  if (suggestedCode === code) return "suggested";
  if (rankMap.has(code)) return "recent";
  return "available";
}

// Tailwind classes keyed by zone state.
// Uses CSS variable tokens so dark/light themes apply automatically.
const ZONE_FILL: Record<ZoneState, string> = {
  selected: "fill-accent stroke-accent",
  suggested: "fill-accent/10 stroke-accent",
  recent: "fill-warn/10 stroke-warn",
  available: "fill-surface/40 stroke-muted/50",
};

const ZONE_STROKE_WIDTH: Record<ZoneState, number> = {
  selected: 2.5,
  suggested: 2,
  recent: 1.5,
  available: 1,
};

export function BodyMap({ value, onChange, recentSites, recencyDaysByCode, design = "current" }: BodyMapProps) {
  const pit = design === "pitstop";
  const suggestedCode = suggestNextSite(recentSites);
  const rankMap = recencyRank(recentSites);
  const selectId = useId();

  // Determine initial view: value's view > suggested's view > front.
  function initialView(): "front" | "back" {
    if (value && ZONE_PATHS[value]) return ZONE_PATHS[value].view;
    if (suggestedCode && ZONE_PATHS[suggestedCode]) return ZONE_PATHS[suggestedCode].view;
    return "front";
  }

  const [view, setView] = useState<"front" | "back">(initialView);

  const selectedLabel = value
    ? (SITE_OPTIONS.find((o) => o.code === value)?.label ?? value)
    : null;

  const currentZones = SITE_OPTIONS.filter(
    (o) => ZONE_PATHS[o.code]?.view === view
  );

  function handleZoneActivate(code: string) {
    onChange(code);
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Front / Back toggle */}
      <div
        role="group"
        aria-label="Silhouette view"
        className="flex rounded-control border border-line/20 text-sm overflow-hidden"
      >
        {(["front", "back"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={`px-4 py-1.5 font-medium transition-colors ${
              view === v
                ? "bg-accent text-onAccent"
                : "bg-surface text-muted hover:text-ink"
            }`}
          >
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {/* SVG silhouette */}
      <svg
        viewBox={SILHOUETTE_VIEWBOX}
        xmlns="http://www.w3.org/2000/svg"
        className="w-full max-w-[200px]"
        aria-label={`Body map — ${view} view`}
        role="img"
      >
        {/* Silhouette body background */}
        <Silhouette view={view} />

        {/* Zone hit areas */}
        {currentZones.map((opt) => {
          const zp = ZONE_PATHS[opt.code];
          if (!zp) return null;
          const state = getZoneState(opt.code, value, suggestedCode, rankMap);
          const days = recencyDaysByCode?.[opt.code];
          const isSelected = state === "selected";
          // Pitstop: recolour "recent" zones to muted-grey DASHED rings (hi-viz
          // lime is reserved elsewhere in this pack). Pure presentation — does
          // not touch the hit-area geometry or handlers.
          const pitRecent = pit && state === "recent";
          const zoneClass = pitRecent ? "fill-none stroke-muted" : ZONE_FILL[state];
          const zoneDash = pitRecent ? "2 2" : undefined;

          return (
            <g
              key={opt.code}
              role="button"
              aria-label={opt.label}
              aria-pressed={isSelected}
              tabIndex={0}
              className="cursor-pointer focus-visible:[outline:2px_solid_rgb(var(--accent))] focus-visible:[outline-offset:2px]"
              onClick={() => handleZoneActivate(opt.code)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleZoneActivate(opt.code);
                }
              }}
            >
              <path
                d={zp.d}
                className={zoneClass}
                strokeWidth={ZONE_STROKE_WIDTH[state]}
                strokeDasharray={zoneDash}
                strokeLinejoin="round"
              />
              {/* Suggested glow ring */}
              {state === "suggested" && (
                <path
                  d={zp.d}
                  fill="none"
                  className="stroke-accent/30"
                  strokeWidth={5}
                  strokeLinejoin="round"
                />
              )}
              {/* Selected checkmark */}
              {isSelected && (
                <text
                  x={zp.labelX}
                  y={zp.labelY + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={10}
                  className="fill-onAccent select-none pointer-events-none font-bold"
                >
                  ✓
                </text>
              )}
              {/* Days-ago label for recent zones */}
              {state === "recent" && days != null && (
                <text
                  x={zp.labelX}
                  y={zp.labelY + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={8}
                  className="fill-warn select-none pointer-events-none"
                >
                  {days}d
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Selected label */}
      {selectedLabel && (
        <p className="text-sm font-medium text-ink" aria-live="polite">
          Selected: {selectedLabel}
        </p>
      )}

      {/* sr-only native <select> — AT fallback */}
      <label className="sr-only" htmlFor={selectId}>
        Injection site (select)
      </label>
      <select
        id={selectId}
        value={value ?? ""}
        onChange={(e) => {
          const code = e.target.value;
          if (code) {
            onChange(code);
            // Flip view to show the selected zone.
            if (ZONE_PATHS[code]) setView(ZONE_PATHS[code].view);
          }
        }}
        className="sr-only"
        aria-label="Injection site"
      >
        <option value="">— not recorded —</option>
        {SITE_OPTIONS.map((o) => (
          <option key={o.code} value={o.code}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
