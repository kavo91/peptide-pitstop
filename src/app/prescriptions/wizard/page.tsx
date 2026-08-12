import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/owner";
import { prisma } from "@/lib/db";
import { prescriptionWizardEnabled } from "@/lib/features";
import { getSyringeOptions } from "@/lib/options";
import { PEPTIDE_LIBRARY } from "@/lib/peptide-library";
import { PrescriptionWizardForm } from "@/components/PrescriptionWizardForm";

export const dynamic = "force-dynamic";

export default async function PrescriptionWizardPage() {
  if (!prescriptionWizardEnabled()) notFound();

  const user = await getCurrentUser();
  if (!user) return null;

  const [peptides, stacks, syringes] = await Promise.all([
    prisma.peptide.findMany({
      where: { OR: [{ userId: user.id }, { userId: null }] },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        aliases: true,
        category: true,
        substanceClass: true,
        defaultStrengthMg: true,
        halfLifeHours: true,
        minIntervalHours: true,
        missedDosePolicy: true,
        route: true,
        storageNotes: true,
      },
    }),
    prisma.stack.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, notes: true },
    }),
    getSyringeOptions(user.id),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight">Prescription Wizard</h1>
        <p className="mt-2 text-sm text-muted">
          Record an existing script and create a ready-to-track setup in one save.
        </p>
      </div>
      <div className="mt-6">
        <PrescriptionWizardForm
          peptides={peptides.map((peptide) => ({
            id: peptide.id,
            name: peptide.name,
            aliases: peptide.aliases ?? "",
            category: peptide.category ?? "",
            substanceClass: peptide.substanceClass,
            defaultStrengthMg: peptide.defaultStrengthMg?.toString() ?? "",
            halfLifeHours: peptide.halfLifeHours?.toString() ?? "",
            minIntervalHours: peptide.minIntervalHours?.toString() ?? "",
            missedDosePolicy: peptide.missedDosePolicy,
            route: peptide.route,
            storageNotes: peptide.storageNotes ?? "",
          }))}
          library={PEPTIDE_LIBRARY.map((entry) => ({
            name: entry.name,
            aliases: entry.aliases ?? "",
            category: entry.category ?? "",
            substanceClass: entry.substanceClass ?? "mass",
            defaultStrengthMg: "",
            halfLifeHours: entry.halfLifeHours ?? "",
            route: "injection",
            storageNotes: entry.storageNotes ?? "",
          }))}
          stacks={stacks}
          syringes={syringes}
        />
      </div>
    </main>
  );
}
