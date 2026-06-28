import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/owner";
import { prisma } from "@/lib/db";
import { getPeptideOptions } from "@/lib/options";
import { decryptField } from "@/lib/crypto/fieldEncryption";
import { PrescriptionForm } from "@/components/PrescriptionForm";

export const dynamic = "force-dynamic";

function toDateInput(d: Date | null): string | undefined {
  return d ? new Date(d).toISOString().slice(0, 10) : undefined;
}

export default async function EditPrescriptionPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return null;

  const rx = await prisma.prescription.findFirst({ where: { id: params.id, userId: user.id } });
  if (!rx) notFound();
  // Stack (grouped) prescriptions are edited from the stack card, not this
  // per-peptide form (they have no single peptide).
  if (rx.stackId) redirect("/settings");

  const peptides = await getPeptideOptions(user.id);

  const initial = {
    id: rx.id,
    peptideId: rx.peptideId ?? "",
    source: rx.source ?? undefined,
    pharmacy: decryptField(rx.pharmacy) ?? undefined,
    prescriber: decryptField(rx.prescriber) ?? undefined,
    cost: rx.cost?.toString() ?? undefined,
    currency: rx.currency ?? "AUD",
    quantity: rx.quantity?.toString() ?? undefined,
    refillsAuthorized: rx.refillsAuthorized?.toString() ?? undefined,
    refillsRemaining: rx.refillsRemaining?.toString() ?? undefined,
    dateWritten: toDateInput(rx.dateWritten),
    nextRefill: toDateInput(rx.nextRefill),
    expiration: toDateInput(rx.expiration),
    leadTimeDays: rx.leadTimeDays?.toString() ?? undefined,
    doseInstructions: decryptField(rx.doseInstructions) ?? undefined,
    status: rx.status,
  };

  return (
    <main className="mx-auto max-w-md px-4 py-8 lg:max-w-2xl lg:px-8">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Edit prescription</h1>
      <PrescriptionForm peptides={peptides} initial={initial} />
    </main>
  );
}
