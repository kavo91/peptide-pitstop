import { getCurrentUser } from "@/lib/auth/owner";
import { getPeptideOptions, getPrescriptionOptions } from "@/lib/options";
import { VialForm } from "@/components/VialForm";

export const dynamic = "force-dynamic";

export default async function NewVialPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const peptides = await getPeptideOptions(user.id);
  const prescriptions = await getPrescriptionOptions(user.id);

  return (
    <main className="mx-auto max-w-md px-4 py-8 lg:max-w-2xl lg:px-8">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Add vial</h1>
      <VialForm peptides={peptides} prescriptions={prescriptions} />
    </main>
  );
}
