import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/owner";
import { getPurchaseEditorData, getPurchases } from "@/lib/costs";
import { BackButton } from "@/components/BackButton";
import { PurchaseForm } from "@/components/PurchaseForm";
import { PitstopHeading } from "@/components/PitstopHeading";
import { activeDesign } from "@/lib/design";
import { PAGE_MAIN } from "@/lib/layout";
import type { PurchaseInput } from "@/app/actions/purchases";

export const dynamic = "force-dynamic";

export default async function EditPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const purchase = (await getPurchases(user.id)).find((p) => p.id === id);
  if (!purchase) notFound();

  const { peptides, vials } = await getPurchaseEditorData(user.id, id);

  const initial: PurchaseInput = {
    id: purchase.id,
    vendor: purchase.vendor ?? "",
    reference: purchase.reference ?? "",
    orderedAt: purchase.orderedAt,
    receivedAt: purchase.receivedAt ?? "",
    currency: purchase.currency,
    shippingCost: purchase.shippingCost,
    taxCost: purchase.taxCost,
    otherFees: purchase.otherFees,
    discount: purchase.discount,
    allocationMethod: purchase.allocationMethod,
    notes: purchase.notes ?? "",
    items: purchase.items.map((i) => ({
      id: i.id,
      kind: i.kind,
      peptideId: i.peptideId ?? undefined,
      category: i.category ?? undefined,
      description: i.description,
      quantity: String(i.quantity),
      unitCost: i.unitCost,
      unitsPerPack: i.unitsPerPack != null ? String(i.unitsPerPack) : "",
      unitsPerDose: i.unitsPerDose ?? "",
      vialIds: i.vialIds,
    })),
  };

  return (
    <main className={PAGE_MAIN}>
      <BackButton fallback="/costs" />
      <PitstopHeading title="Edit invoice" index={12} design={activeDesign()} className="mb-1 text-3xl font-semibold tracking-tight" split={["IN", "VOICE"]} />
      <p className="mb-6 text-muted">{purchase.vendor ?? "Order"} · {purchase.orderedAt}</p>
      <PurchaseForm peptides={peptides} vials={vials} initial={initial} />
    </main>
  );
}
