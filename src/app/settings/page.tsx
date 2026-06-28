/**
 * Settings — reference data management: peptides and syringes. Both feed the
 * CRUD selects elsewhere (vials, protocols, dose logging).
 */
import { Download } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/owner";
import { prisma } from "@/lib/db";
import { PEPTIDE_LIBRARY } from "@/lib/peptide-library";
import { getEnrichmentSeed } from "@/lib/peptide-enrichment";
import { PeptideManager } from "@/components/PeptideManager";
import { StackBuilder } from "@/components/StackBuilder";
import { StackCard } from "@/components/StackCard";
import { getStacks } from "@/lib/stacks/server";
import { SyringeManager } from "@/components/SyringeManager";
import { ReorderDefaultsForm } from "@/components/ReorderDefaultsForm";
import { WellnessSettingsForm } from "@/components/WellnessSettingsForm";
import { ReportExportForm } from "@/components/ReportExportForm";
import { BackButton } from "@/components/BackButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SignOutEverywhereButton } from "@/components/SignOutEverywhereButton";
import { PitstopHeading } from "@/components/PitstopHeading";
import { signOutEverywhere } from "@/app/actions/auth";
import { PAGE_MAIN } from "@/lib/layout";

const EXPORTS = [
  { type: "doses", label: "Doses", sub: "Injection log: peptide, dose, site, notes" },
  { type: "labs", label: "Bloodwork", sub: "Lab results with biomarker, value, references" },
  { type: "journal", label: "Wellness journal", sub: "Weight, mood, energy, sleep, side effects" },
  { type: "wearable", label: "Wearable", sub: "Daily Garmin metrics (sleep, HRV, steps…)" },
] as const;

export const dynamic = "force-dynamic";

/** The user's custom symptom override as a string[], or null when unset/invalid. */
function parseSymptomOverride(json: string | null): string[] | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed)) {
      const names = parsed.filter((x): x is string => typeof x === "string");
      return names.length ? names : null;
    }
  } catch {
    /* ignore malformed override */
  }
  return null;
}

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) return <main className="mx-auto max-w-md px-4 py-10"><p className="text-muted">Not signed in.</p></main>;

  const peptides = (
    await prisma.peptide.findMany({ where: { OR: [{ userId: user.id }, { userId: null }] }, orderBy: { name: "asc" } })
  ).map((p) => ({
    id: p.id,
    // True for the user's own peptides; false for shared-library rows (userId: null).
    // Drives Edit/Delete gating in PeptideManager — those mutations refuse on shared rows.
    owned: p.userId === user.id,
    name: p.name,
    aliases: p.aliases ?? "",
    category: p.category ?? "",
    substanceClass: p.substanceClass,
    defaultStrengthMg: p.defaultStrengthMg?.toString() ?? "",
    halfLifeHours: p.halfLifeHours?.toString() ?? "",
    minIntervalHours: p.minIntervalHours?.toString() ?? "",
    missedDosePolicy: p.missedDosePolicy,
    storageNotes: p.storageNotes ?? "",
    route: p.route,
  }));

  // Library entries the user hasn't already added (matched by name, case-insensitive).
  // Match by name OR alias so e.g. owning "Thymosin Beta-4" hides the library's "TB-500".
  const tokens = (name: string, aliases?: string) =>
    [name, ...(aliases ?? "").split(",")].map((s) => s.trim().toLowerCase()).filter(Boolean);
  const ownedTokens = new Set(peptides.flatMap((p) => tokens(p.name, p.aliases)));
  const libraryAvailable = PEPTIDE_LIBRARY.filter((e) => !tokens(e.name, e.aliases).some((t) => ownedTokens.has(t)));

  // Library half-life by token — fall back to it for an owned peptide whose stored
  // halfLifeHours is empty (e.g. added before the library carried that value, like
  // GHK-Cu). Display-only fallback; opening Edit pre-fills it so a save persists it.
  const libHalfLife = (name: string, aliases?: string): string => {
    const ts = tokens(name, aliases);
    const hit = PEPTIDE_LIBRARY.find((e) => tokens(e.name, e.aliases).some((t) => ts.includes(t)));
    return hit?.halfLifeHours ?? "";
  };

  // Attach enrichment (sync seed — no DB, SSR-safe) for both owned peptides and
  // the library picker so PeptideManager can surface the detail panel + Apply.
  const peptidesWithEnrichment = peptides.map((p) => ({
    ...p,
    halfLifeHours: p.halfLifeHours || libHalfLife(p.name, p.aliases),
    enrichment: getEnrichmentSeed(p.name, p.aliases) ?? null,
  }));
  const libraryWithEnrichment = libraryAvailable.map((e) => ({ ...e, enrichment: getEnrichmentSeed(e.name, e.aliases) ?? null }));

  // Component options for the stack builder: every library peptide + the user's
  // own peptides (so a stack can mix singles, blends and already-owned items).
  const stackOptions = Array.from(
    new Set([...PEPTIDE_LIBRARY.map((e) => e.name), ...peptides.map((p) => p.name)]),
  ).sort((a, b) => a.localeCompare(b));

  const stacks = await getStacks(user.id);

  const syringes = (
    await prisma.syringe.findMany({ where: { OR: [{ userId: user.id }, { userId: null }] }, orderBy: { name: "asc" } })
  ).map((s) => ({
    id: s.id,
    name: s.name,
    graduationType: s.graduationType,
    unitsPerMl: String(s.unitsPerMl),
    capacityMl: s.capacityMl.toString(),
    capacityUnits: String(s.capacityUnits),
    increment: s.increment.toString(),
  }));

  return (
    <main className={PAGE_MAIN}>
      <BackButton />
      <PitstopHeading title="Settings" index={10} className="mb-1 text-3xl font-semibold tracking-tight" split={["SET", "TINGS"]} />
      <p className="mb-6 text-muted">Manage your peptides and syringes.</p>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-muted">Appearance</h2>
        <ThemeToggle />
      </section>

      {/* Ultra-wide two-up. Below 1440px this wrapper is a plain block and the two
          inner columns are plain blocks, so the sections stack in DOM order exactly
          as before (Peptides → Syringes → Reorder → Wellness → Export → Security).
          At ≥1440px the two columns sit side-by-side: LEFT = Peptides + Syringes
          (reference data), RIGHT = Reorder + Wellness + Data export + Security. This
          split balances the column heights so the page is much shorter at ultrawide.
          Mobile DOM order is unchanged because the left <div> flattens before the
          right one. */}
      <div className="min-[1440px]:grid min-[1440px]:grid-cols-2 min-[1440px]:gap-x-6 min-[1440px]:items-start">
        <div>
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-medium text-muted">Peptides</h2>
            <PeptideManager peptides={peptidesWithEnrichment} library={libraryWithEnrichment} />
            {stacks.length > 0 && (
              <div className="mt-3 space-y-2">
                {stacks.map((s) => (
                  <StackCard key={s.id} stack={s} manage />
                ))}
              </div>
            )}
            <div className="mt-3">
              <StackBuilder options={stackOptions} />
            </div>
          </section>

          {/* Syringes — moved into the left column at desktop to balance heights.
              Sits below Peptides on mobile (unchanged order). The desktop-only
              mb-0 drops the trailing gap so the left column doesn't over-pad. */}
          <section className="mb-8 min-[1440px]:mb-0">
            <h2 className="mb-3 text-sm font-medium text-muted">Syringes</h2>
            <SyringeManager syringes={syringes} />
          </section>
        </div>

        {/* The right column's first child (ReorderDefaultsForm) carries its own
            mt-8. Inside a grid cell that margin no longer collapses out, so it
            would push this column 32px below the left one. Cancel it at desktop so
            the two columns top-align. Mobile (block flow) is untouched. */}
        <div className="min-[1440px]:-mt-8">
          <ReorderDefaultsForm leadTimeDays={user.reorderLeadTimeDays ?? 14} bufferDays={user.reorderBufferDays ?? 3} />

          <WellnessSettingsForm
            hydrationTargetMl={user.hydrationTargetMl ?? null}
            symptomList={parseSymptomOverride(user.symptomList)}
          />

          <section className="mt-8">
            <h2 className="mb-1 text-sm font-medium text-muted">Data export</h2>
            <p className="mb-3 text-sm text-muted">Download your data as CSV. Encrypted fields are decrypted in the export.</p>
            <ul className="grid gap-2 lg:grid-cols-2">
              {EXPORTS.map((e) => (
                <li key={e.type}>
                  <a
                    href={`/api/export/${e.type}`}
                    download
                    className="flex items-center justify-between gap-3 rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10"
                  >
                    <div>
                      <p className="font-medium">{e.label}</p>
                      <p className="text-sm text-muted">{e.sub}</p>
                    </div>
                    <Download className="h-4 w-4 text-muted" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <ReportExportForm />
            </div>
          </section>

          <section className="mt-8">
            <h2 className="mb-1 text-sm font-medium text-muted">Security</h2>
            <p className="mb-3 text-sm text-muted">Revoke every active session, including this one.</p>
            <SignOutEverywhereButton action={signOutEverywhere} />
          </section>
        </div>
      </div>
    </main>
  );
}
