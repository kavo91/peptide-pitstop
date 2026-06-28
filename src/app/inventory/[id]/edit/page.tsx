import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/owner";
import { prisma } from "@/lib/db";
import { getPeptideOptions, getPrescriptionOptions } from "@/lib/options";
import { VialForm } from "@/components/VialForm";

export const dynamic = "force-dynamic";

function toDateInput(d: Date | null): string | undefined {
  return d ? new Date(d).toISOString().slice(0, 10) : undefined;
}

export default async function EditVialPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return null;

  const vial = await prisma.vial.findFirst({ where: { id: params.id, userId: user.id } });
  if (!vial) notFound();

  const peptides = await getPeptideOptions(user.id);
  const prescriptions = await getPrescriptionOptions(user.id);

  const initial = {
    id: vial.id,
    peptideId: vial.peptideId,
    labelStrengthMg: vial.labelStrengthMg.toString(),
    prescriptionId: vial.prescriptionId ?? undefined,
    lot: vial.lot ?? undefined,
    expiry: toDateInput(vial.expiry),
    storageLocation: vial.storageLocation ?? undefined,
    status: vial.status,
  };

  return (
    <main className="mx-auto max-w-md px-4 py-8 lg:max-w-2xl lg:px-8">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Edit vial</h1>
      <VialForm peptides={peptides} prescriptions={prescriptions} initial={initial} />
    </main>
  );
}
