"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { validateBlendComponents, type BlendComponentDraft } from "@/lib/blend-validate";
import { blendMassCheck } from "@/lib/blends-core";

/**
 * Replace the component set of a blend peptide.
 *
 * Components are the composition of ONE physical vial of blended powder. They
 * are reference data only — no DoseLog is touched, and every downstream figure
 * derived from them is labelled as derived.
 */
export async function saveBlendComponents(input: {
  peptideId: string;
  components: BlendComponentDraft[];
}) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  // The blend must belong to the caller.
  const blend = await prisma.peptide.findFirst({
    where: { id: input.peptideId, userId: user.id },
    select: { id: true },
  });
  if (!blend) return { ok: false as const, error: "Peptide not found." };

  const validated = validateBlendComponents(input.peptideId, input.components);
  if (!validated.ok) return { ok: false as const, error: validated.error };

  // Every component peptide must also belong to the caller — otherwise a blend
  // could reference someone else's row.
  const ids = validated.rows.map((r) => r.componentPeptideId);
  if (ids.length > 0) {
    const owned = await prisma.peptide.count({
      where: { id: { in: ids }, OR: [{ userId: user.id }, { userId: null }] },
    });
    if (owned !== ids.length) return { ok: false as const, error: "Unknown component peptide." };

    // Components must be simple compounds. Two shapes of nesting are rejected:
    //   1. a proposed component is itself a blend (A ⊃ B where B has components),
    //      which also closes the A ⊃ B, B ⊃ A cycle — the second save fails;
    //   2. the blend being edited is already a component of another blend, so
    //      giving IT components would nest it one level down.
    // Nested ratios would multiply through silently — wrong attribution with no
    // surface to show it on.
    const [componentBlends, usedAsComponent] = await Promise.all([
      prisma.blendComponent.findMany({
        where: { peptideId: { in: ids } },
        select: { peptideId: true, peptide: { select: { name: true } } },
        distinct: ["peptideId"],
      }),
      prisma.blendComponent.findFirst({
        where: { componentPeptideId: input.peptideId },
        select: { peptide: { select: { name: true } } },
      }),
    ]);
    if (componentBlends.length > 0) {
      const names = componentBlends.map((b) => b.peptide.name).join(", ");
      return { ok: false as const, error: `${names} is itself a blend — components must be simple compounds.` };
    }
    if (usedAsComponent) {
      return {
        ok: false as const,
        error: `This peptide is a component of ${usedAsComponent.peptide.name} — it cannot have components of its own.`,
      };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.blendComponent.deleteMany({
        where: { peptideId: input.peptideId, componentPeptideId: { notIn: ids.length ? ids : ["__none__"] } },
      });
      for (const r of validated.rows) {
        await tx.blendComponent.upsert({
          where: {
            peptideId_componentPeptideId: {
              peptideId: input.peptideId,
              componentPeptideId: r.componentPeptideId,
            },
          },
          create: {
            peptideId: input.peptideId,
            componentPeptideId: r.componentPeptideId,
            massMg: r.massMg.toString(),
            source: r.source,
            sortIndex: r.sortIndex,
          },
          update: { massMg: r.massMg.toString(), source: r.source, sortIndex: r.sortIndex },
        });
      }
    });
  } catch (e) {
    console.error("saveBlendComponents failed", e);
    return { ok: false as const, error: "Could not save the components." };
  }

  revalidatePath("/settings");
  revalidatePath("/analytics");
  revalidatePath("/costs");

  // Advisory only — a mis-set defaultStrengthMg must never block the save, but
  // a mismatch means every derived figure scales off a total that disagrees
  // with the vial label, so the caller is told.
  const blend2 = await prisma.peptide.findUnique({
    where: { id: input.peptideId },
    select: { defaultStrengthMg: true },
  });
  const check = blendMassCheck(
    validated.rows.map((r, i) => ({
      componentPeptideId: r.componentPeptideId,
      componentName: r.componentPeptideId,
      massMg: r.massMg,
      source: r.source,
      sortIndex: i,
    })),
    blend2?.defaultStrengthMg ? Number(blend2.defaultStrengthMg.toString()) : null,
  );
  return {
    ok: true as const,
    warning: check.ok
      ? null
      : `Components total ${check.sumMg} mg but the vial label says ${check.expectedMg} mg — derived figures will scale off ${check.sumMg} mg.`,
  };
}
