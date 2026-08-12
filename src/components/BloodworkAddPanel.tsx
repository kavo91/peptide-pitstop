"use client";

import { useState, type ComponentProps } from "react";
import { FileUp } from "lucide-react";
import { PitstopHeading } from "@/components/PitstopHeading";
import { LabPanelForm } from "@/components/LabPanelForm";

/**
 * Bloodwork header + "Add lab panel" affordance. The button lives in the page
 * header row (heading left, button right) — matching the "+ Add protocol" /
 * "+ Add prescription" pattern — and toggles the inline LabPanelForm full-width
 * below the header. (Native <details> can't keep the heading visible while its
 * toggle sits in a separate header row, so this is a small client toggle.)
 */
export function BloodworkAddPanel({
  design,
  pit,
  biomarkers,
  defaultOpen,
}: {
  design: "pitstop" | "current";
  pit: boolean;
  biomarkers: ComponentProps<typeof LabPanelForm>["biomarkers"];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <PitstopHeading title="Bloodwork" index={4} design={design} className="mb-1 text-3xl font-semibold tracking-tight" split={["BLOOD", "WORK"]} />
          {pit && (
            <p className="mb-2 font-mono uppercase tracking-[0.16em] text-[11px] text-muted">Last 3 panels · trending</p>
          )}
          <p className="text-muted">
            Log lab panels and track biomarkers over time.
            <span className="block text-xs">Reference only — not medical advice.</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-control bg-accent px-3 py-2 text-sm font-medium text-onAccent"
        >
          <FileUp aria-hidden className="h-4 w-4 shrink-0" />
          {open ? "Close" : "+ Add lab panel"}
        </button>
      </div>
      {open && (
        <div className="mb-8">
          <LabPanelForm biomarkers={biomarkers} />
        </div>
      )}
    </>
  );
}
