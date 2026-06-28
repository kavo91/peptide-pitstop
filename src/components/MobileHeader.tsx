"use client";

import { usePathname } from "next/navigation";
import { LogoLockup } from "@/components/Logo";
import type { TodayDoseStatus } from "@/lib/today";

/**
 * Slim mobile-only brand bar. Hidden on lg+ (where SideNav carries the logo)
 * and on the unauthenticated auth screens. Sticky so it stays put while the
 * page scrolls; mirrors BottomNav's pathname guard.
 *
 * `doseStatus` is threaded from the server layout ONLY under the pitstop design
 * (undefined otherwise). When present it renders a right-aligned today-status
 * chip; when undefined the header is byte-identical to the current design.
 */
export function MobileHeader({ envLabel, doseStatus }: { envLabel?: string | null; doseStatus?: TodayDoseStatus }) {
  const pathname = usePathname() ?? "/";
  if (pathname === "/login" || pathname === "/setup") return null;
  // Behind = at least one overdue dose; otherwise on track (covers "none" too —
  // nothing due reads as on track, which is correct: red = bad, green = good).
  const behind = doseStatus?.status === "behind";
  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line/10 bg-surface/80 px-4 py-2.5 backdrop-blur-sm lg:hidden">
      <LogoLockup markSize={26} textClass="text-base" />
      {envLabel && (
        <span className="rounded-full bg-[rgb(var(--env))] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[rgb(14_15_18)] ring-1 ring-[rgb(var(--env))]">{envLabel}</span>
      )}
      {doseStatus && (
        <span
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wide ring-1 ${
            behind ? "bg-danger text-white ring-danger" : "bg-ok/20 text-ok ring-ok/50"
          }`}
        >
          <span className={`pitstop-status-dot ${behind ? "bg-white" : "bg-ok"}`} />
          {behind ? "BEHIND" : "ON TRACK"}
        </span>
      )}
    </header>
  );
}
