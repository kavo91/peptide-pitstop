import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/owner";
import { getPurchaseEditorData } from "@/lib/costs";
import { BackButton } from "@/components/BackButton";
import { PurchaseForm } from "@/components/PurchaseForm";
import { PitstopHeading } from "@/components/PitstopHeading";
import { activeDesign } from "@/lib/design";
import { PAGE_MAIN } from "@/lib/layout";

export const dynamic = "force-dynamic";

export default async function NewPurchasePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { peptides, vials } = await getPurchaseEditorData(user.id);

  return (
    <main className={PAGE_MAIN}>
      <BackButton fallback="/costs" />
      <PitstopHeading title="New invoice" index={12} design={activeDesign()} className="mb-1 text-3xl font-semibold tracking-tight" split={["IN", "VOICE"]} />
      <p className="mb-6 text-muted">Enter shipping once — it is shared across every line on the order.</p>
      <PurchaseForm peptides={peptides} vials={vials} />
    </main>
  );
}
