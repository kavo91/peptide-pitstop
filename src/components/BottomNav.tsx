"use client";

/**
 * Bottom tab bar — primary mobile navigation.
 *
 * Tabs: Dashboard(/) · Doses(/doses) · Log(/log, centre) · Inventory(/inventory) · More(/more).
 *
 * Protocols is intentionally NOT a tab — it moved to the More list (design decision,
 * 2026-06-17 UI refresh). Routes that live only behind More (see MORE_ROUTES:
 * Prescriptions, Analytics, Protocols, Wellness/journal, Bloodwork, Settings) light
 * the More tab when no other tab matches the current route. Do NOT add any of them
 * back as a tab without a design review.
 *
 * isActive uses exact match for "/" so /doses, /log, etc. don't collide with Dashboard.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, CalendarDays, Plus, FlaskConical, Menu, type LucideIcon } from "lucide-react";

interface Tab {
  href: string;
  label: string;
  /** For "/" use exact match; for all others startsWith. */
  match: string;
  icon: LucideIcon;
}

const TABS: Tab[] = [
  { href: "/",           label: "Dashboard",  match: "/",           icon: LayoutDashboard },
  { href: "/doses",      label: "Doses",      match: "/doses",      icon: CalendarDays },
  { href: "/log",        label: "Log",        match: "/log",        icon: Plus },
  { href: "/inventory",  label: "Inventory",  match: "/inventory",  icon: FlaskConical },
  { href: "/more",       label: "More",       match: "/more",       icon: Menu },
];

/**
 * Routes that have no tab of their own — they live behind the More page. When the
 * user is on one of these, the More tab lights up (no other tab would match).
 * NB: "/doses" is deliberately absent — it owns the Doses tab.
 */
const MORE_ROUTES = ["/prescriptions", "/analytics", "/protocols", "/journal", "/bloodwork", "/settings"];

function isActive(pathname: string, match: string): boolean {
  return match === "/" ? pathname === "/" : pathname.startsWith(match);
}

export function BottomNav() {
  const pathname = usePathname() ?? "/";

  // No app nav on the unauthenticated auth screens.
  if (pathname === "/login" || pathname === "/setup") return null;

  // The More tab owns no route of its own, so it lights up for any MORE_ROUTES
  // page — but only when no other tab already matches the current route.
  const otherTabActive = TABS.some((t) => t.href !== "/more" && isActive(pathname, t.match));
  const moreActive =
    isActive(pathname, "/more") || (!otherTabActive && MORE_ROUTES.some((r) => pathname.startsWith(r)));

  return (
    <nav data-bottom-nav className="sticky bottom-0 z-10 mx-auto flex w-full max-w-md items-stretch justify-around border-t border-line/10 bg-surface/95 backdrop-blur lg:hidden">
      {TABS.map((t) => {
        const active = t.href === "/more" ? moreActive : isActive(pathname, t.match);
        const center = t.href === "/log";
        const Icon = t.icon;
        if (center) {
          return (
            <Link
              key={t.href}
              href={t.href}
              className="flex flex-1 flex-col items-center justify-center py-1.5"
              aria-current={active ? "page" : undefined}
            >
              <span className="pitstop-log-pill -mt-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-onAccent shadow-md">
                <Icon className="h-6 w-6" aria-hidden />
              </span>
              <span className={`text-[11px] font-medium ${active ? "text-accentStrong" : "text-muted"}`}>{t.label}</span>
            </Link>
          );
        }
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${active ? "text-accentStrong" : "text-muted"}`}
          >
            <Icon className="h-5 w-5" aria-hidden />
            {t.label}
            {/* Active-item indicator. Inert in the default design (Tailwind
                `hidden`); the pitstop pack renders it as an orange lean-slash
                under the active tab — see globals.css. */}
            {active && <span className="pitstop-nav-sector hidden" aria-hidden />}
          </Link>
        );
      })}
    </nav>
  );
}
