import { getCurrentUser } from "@/lib/auth/owner";
import { prisma } from "@/lib/db";
import { getPeptideOptions } from "@/lib/options";
import { PrescriptionForm } from "@/components/PrescriptionForm";

export const dynamic = "force-dynamic";

export default async function NewPrescriptionPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const peptides = await getPeptideOptions(user.id);
  // Stacks selectable as a single grouped-prescription target.
  const stacks = (
    await prisma.stack.findMany({ where: { userId: user.id }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } })
  ).map((s) => ({ id: s.id, name: s.name }));

  return (
    <main className="mx-auto max-w-md px-4 py-8 lg:max-w-2xl lg:px-8">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Add prescription</h1>
      <PrescriptionForm peptides={peptides} stacks={stacks} />
    </main>
  );
}
