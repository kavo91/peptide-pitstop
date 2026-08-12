import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/owner";
import { prisma } from "@/lib/db";
import { getPeptideOptions, getPrescriptionOptions, getSyringeOptions } from "@/lib/options";
import { ProtocolForm } from "@/components/ProtocolForm";

export const dynamic = "force-dynamic";

export default async function NewProtocolPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  // One protocol per peptide — only offer peptides that don't already have one.
  const taken = new Set((await prisma.protocol.findMany({ where: { userId: user.id }, select: { peptideId: true } })).map((p) => p.peptideId));
  const peptides = (await getPeptideOptions(user.id)).filter((p) => !taken.has(p.id));
  const prescriptions = await getPrescriptionOptions(user.id);
  const syringes = await getSyringeOptions(user.id);

  return (
    <main className="mx-auto max-w-md px-4 py-8 lg:max-w-2xl lg:px-8">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">New protocol</h1>
      {peptides.length === 0 ? (
        <p className="text-muted">Every peptide already has a protocol. Edit an existing one from <Link href="/protocols" className="font-medium text-accentStrong">Protocols</Link>, or add a new peptide in Settings first.</p>
      ) : (
        <ProtocolForm peptides={peptides} prescriptions={prescriptions} syringes={syringes} />
      )}
    </main>
  );
}
