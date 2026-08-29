import "server-only";
import { prisma } from "@/lib/db";
import { expandBlendDose, type BlendComponent, type DerivedComponentDose } from "./blends-core";

export {
  rollUpExposure,
  type StandaloneExposure,
  type ExposureRow,
} from "./blends-core";

/** Components of a blend, ready for blends-core. Returns [] for a non-blend. */
export async function componentsForPeptide(peptideId: string): Promise<BlendComponent[]> {
  const rows = await prisma.blendComponent.findMany({
    where: { peptideId },
    include: { componentPeptide: { select: { name: true } } },
    orderBy: { sortIndex: "asc" },
  });
  return rows.map((r) => ({
    componentPeptideId: r.componentPeptideId,
    componentName: r.componentPeptide.name,
    massMg: Number(r.massMg.toString()),
    source: r.source as BlendComponent["source"],
    sortIndex: r.sortIndex,
  }));
}

/** Expand every logged dose of one blend into derived component doses. */
export async function derivedDosesForBlend(peptideId: string): Promise<DerivedComponentDose[]> {
  const components = await componentsForPeptide(peptideId);
  if (components.length === 0) return [];
  const logs = await prisma.doseLog.findMany({
    where: { protocol: { peptideId } },
    select: { doseMcg: true },
  });
  return logs.flatMap((l) => expandBlendDose(Number(l.doseMcg.toString()), components));
}

/** Every blend the user owns that has components defined. */
export async function blendPeptideIds(userId: string): Promise<string[]> {
  const rows = await prisma.blendComponent.findMany({
    where: { peptide: { userId } },
    select: { peptideId: true },
    distinct: ["peptideId"],
  });
  return rows.map((r) => r.peptideId);
}
