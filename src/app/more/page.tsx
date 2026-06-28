/**
 * More — secondary navigation hub. Surfaces screens that don't earn a tab slot:
 * Prescriptions (live), and the later-phase screens as disabled placeholders so
 * the planned information architecture (spec §7) is visible from day one.
 */
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { logout } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/auth/owner";
import { getReorderStatus } from "@/lib/reorder";
import { APP_VERSION } from "@/lib/version";
import { PitstopHeading } from "@/components/PitstopHeading";
import { PAGE_MAIN } from "@/lib/layout";

export const dynamic = "force-dynamic";

interface Item {
  href: string;
  label: string;
  sub: string;
  phase?: string; // set => coming soon, not yet linked
}

const ITEMS: Item[] = [
  { href: "/prescriptions", label: "Prescriptions", sub: "Refills, cost, expiry, reorder reminders" },
  { href: "/doses",         label: "Doses",         sub: "History & upcoming schedule" },
  { href: "/analytics",     label: "Analytics",     sub: "Dose history, adherence, plasma curve" },
  { href: "/protocols",     label: "Protocols",     sub: "Active and past treatment protocols" },
  { href: "/journal",       label: "Wellness",      sub: "Weight, mood, sleep, side effects" },
  { href: "/bloodwork",     label: "Bloodwork",     sub: "Biomarker trends with reference & optimal bands" },
  { href: "/settings",      label: "Settings",      sub: "Peptides, syringes, reminders, backup" },
];

export default async function MorePage() {
  const user = await getCurrentUser();
  const reorderCount = user ? (await getReorderStatus(user.id)).filter((r) => r.status === "reorder_now").length : 0;
  return (
    <main className={PAGE_MAIN}>
      <PitstopHeading title="More" index={11} className="mb-1 text-3xl font-semibold tracking-tight" split={["MO", "RE"]} />
      {/* Decorative subtitle — hidden on phones to reclaim vertical space (no-scroll budget). */}
      <p className="mb-6 text-muted max-[640px]:hidden">Everything else.</p>

      <ul className="grid gap-2 max-[640px]:gap-1.5 lg:grid-cols-2">
        {ITEMS.map((it) => {
          const inner = (
            <div className="flex items-center justify-between gap-3 rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
              <div>
                <p className="font-medium">{it.label}</p>
                <p className="text-sm text-muted max-[640px]:text-xs">{it.sub}</p>
              </div>
              {it.phase ? (
                <span className="rounded-full bg-line/[0.06] px-2 py-1 text-xs font-medium text-muted">{it.phase}</span>
              ) : it.href === "/prescriptions" && reorderCount > 0 ? (
                <span className="rounded-full bg-warn/15 px-2 py-1 text-xs font-medium text-warn">{reorderCount} to reorder</span>
              ) : (
                <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
              )}
            </div>
          );
          return (
            <li key={it.href}>
              {it.phase ? <div className="opacity-60">{inner}</div> : <Link href={it.href}>{inner}</Link>}
            </li>
          );
        })}
      </ul>

      <form action={logout} className="mt-6 max-[640px]:mt-3">
        <button type="submit" className="w-full rounded-control bg-surface px-4 py-3 text-sm font-medium text-danger ring-1 ring-line/10">Sign out</button>
      </form>

      <p className="mt-8 text-center text-xs text-muted max-[640px]:mt-3 lg:hidden">Peptide Pitstop · not medical advice · v{APP_VERSION}</p>
    </main>
  );
}
