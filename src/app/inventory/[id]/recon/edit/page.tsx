/**
 * Edit the active reconstitution for a vial. Loads the vial's active
 * Preparation (ownership via vial.userId), its logged dose volumes, and the
 * decrypted notes, then renders the prefilled two-stage edit form.
 */
import { getCurrentUser } from "@/lib/auth/owner";
import { prisma } from "@/lib/db";
import { decryptField } from "@/lib/crypto/fieldEncryption";
import { EditPreparationForm } from "@/components/EditPreparationForm";
import { BackButton } from "@/components/BackButton";

export const dynamic = "force-dynamic";

function toDateInput(d: Date | null): string {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}

export default async function EditReconPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return null;

  const prep = await prisma.preparation.findFirst({
    where: { vialId: params.id, active: true, vial: { userId: user.id } },
    include: { doseLogs: { select: { volumeMl: true } } },
  });

  if (!prep) {
    return (
      <main className="mx-auto max-w-md px-4 py-8 lg:max-w-2xl lg:px-8">
        <h1 className="mb-2 text-3xl font-semibold tracking-tight">Edit reconstitution</h1>
        <p className="mb-6 text-muted">No active reconstitution to edit.</p>
        <BackButton fallback="/inventory" />
      </main>
    );
  }

  const prepDTO = {
    id: prep.id,
    prepType: prep.prepType as "reconstituted" | "premixed",
    bacWaterMl: prep.bacWaterMl != null ? prep.bacWaterMl.toString() : null,
    totalMg: prep.totalMg.toString(),
    concentrationMcgPerMl: prep.concentrationMcgPerMl.toString(),
    remainingMl: prep.remainingMl.toString(),
    beyondUseDate: toDateInput(prep.beyondUseDate),
    notes: decryptField(prep.notes) ?? "",
  };
  const doseVolumesMl = prep.doseLogs.map((d) => d.volumeMl.toString());

  return (
    <main className="mx-auto max-w-md px-4 py-8 lg:max-w-2xl lg:px-8">
      <BackButton fallback="/inventory" />
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Edit reconstitution</h1>
      <EditPreparationForm prep={prepDTO} doseVolumesMl={doseVolumesMl} doseCount={doseVolumesMl.length} />
    </main>
  );
}
