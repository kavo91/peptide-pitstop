"use client";

/**
 * Desktop side navigation (lg+). Hidden on mobile, where BottomNav takes over.
 * Mirrors BottomNav's primary destinations and adds the secondary screens that
 * live behind "More" on mobile — on a wide screen there's room to show them all.
 *
 * isActive: exact match for "/" so it doesn't light up on every route; prefix
 * match otherwise (matches BottomNav's convention).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoLockup } from "@/components/Logo";
import { logout } from "@/app/actions/auth";
import { APP_VERSION } from "@/lib/version";
import type { TodayDoseStatus } from "@/lib/today";
import {
  LayoutDashboard, CalendarDays, FlaskConical, LineChart, HeartPulse,
  Droplet, ClipboardList, FileText, Settings, Plus, type LucideIcon,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  match: string;
  icon: LucideIcon;
}

const PRIMARY: NavItem[] = [
  { href: "/", label: "Dashboard", match: "/", icon: LayoutDashboard },
  { href: "/doses", label: "Doses", match: "/doses", icon: CalendarDays },
  { href: "/inventory", label: "Inventory", match: "/inventory", icon: FlaskConical },
];

const SECONDARY: NavItem[] = [
  { href: "/analytics", label: "Analytics", match: "/analytics", icon: LineChart },
  { href: "/journal", label: "Wellness", match: "/journal", icon: HeartPulse },
  { href: "/bloodwork", label: "Bloodwork", match: "/bloodwork", icon: Droplet },
  { href: "/protocols", label: "Protocols", match: "/protocols", icon: ClipboardList },
  { href: "/prescriptions", label: "Prescriptions", match: "/prescriptions", icon: FileText },
  { href: "/settings", label: "Settings", match: "/settings", icon: Settings },
];

function isActive(pathname: string, match: string): boolean {
  return match === "/" ? pathname === "/" : pathname.startsWith(match);
}

export function SideNav({ envLabel, brand, doseStatus }: { envLabel?: string | null; brand: string; doseStatus?: TodayDoseStatus }) {
  const pathname = usePathname() ?? "/";

  // No app nav on the unauthenticated auth screens.
  if (pathname === "/login" || pathname === "/setup") return null;

  // Today-dose status (pitstop only; undefined otherwise → byte-identical).
  const behind = doseStatus?.status === "behind";

  const item = (t: NavItem) => {
    const active = isActive(pathname, t.match);
    const Icon = t.icon;
    return (
      <Link
        key={t.href}
        href={t.href}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-2.5 rounded-control px-3 py-2 text-sm font-medium transition-colors ${
          active
            ? "bg-accent/10 text-accentStrong"
            : "text-muted hover:bg-line/[0.05] hover:text-ink"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        {t.label}
      </Link>
    );
  };

  return (
    <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:border-r lg:border-line/10 lg:bg-surface/40 lg:px-3 lg:py-5">
      <div className="flex items-center gap-2 px-3 pb-4">
        <LogoLockup markSize={30} textClass="text-lg" />
        {envLabel && (
          <span className="rounded-full bg-[rgb(var(--env))] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[rgb(14_15_18)] ring-1 ring-[rgb(var(--env))]">{envLabel}</span>
        )}
      </div>

      {doseStatus && (
        <div className="mb-3 px-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wide ring-1 ${
              behind ? "bg-danger text-white ring-danger" : "bg-ok/20 text-ok ring-ok/50"
            }`}
          >
            <span className={`pitstop-status-dot ${behind ? "bg-white" : "bg-ok"}`} />
            {behind ? "BEHIND" : "ON TRACK"}
          </span>
        </div>
      )}

      <Link
        href="/log"
        aria-current={isActive(pathname, "/log") ? "page" : undefined}
        className="mb-4 flex items-center justify-center gap-1.5 rounded-control bg-accent px-3 py-2.5 text-sm font-semibold text-onAccent shadow-sm transition-opacity hover:opacity-90"
      >
        <Plus className="h-4 w-4" aria-hidden /> Log dose
      </Link>

      <nav className="flex flex-col gap-1">{PRIMARY.map(item)}</nav>
      <div className="my-3 border-t border-line/10" />
      <nav className="flex flex-col gap-1">{SECONDARY.map(item)}</nav>

      <div className="mt-auto pt-4">
        <form action={logout}>
          <button type="submit" className="w-full rounded-control bg-surface px-4 py-3 text-sm font-medium text-danger ring-1 ring-line/10">Sign out</button>
        </form>
        <p className="px-3 pt-4 text-[10px] text-muted">{brand} · not medical advice · v{APP_VERSION}</p>
      </div>
    </aside>
  );
}
