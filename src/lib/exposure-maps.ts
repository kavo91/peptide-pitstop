import "server-only";
import { prisma } from "@/lib/db";
import type { PeptideRef } from "@/lib/analytics-core";

/**
 * One blend component as the exposure roll-up and the plasma chart consume it.
 * `halfLifeHours`/`aliases` feed the per-component plasma curves; `source`
 * (label | coa | assumed) drives the mandatory "derived" badge on any surface
 * that shows blend-delivered mass.
 */
export type BlendComponentRef = {
  name: string;
  mg: number;
  halfLifeHours?: number | null;
  aliases?: string | null;
  source: string;
};

export interface ExposureMaps {
  /** preparationId → the peptide the vial holds (preparation-first resolution). */
  prepPeptide: Map<string, PeptideRef>;
  /** protocolId → the protocol's peptide (fallback when a dose has no preparation). */
  protoPeptide: Map<string, PeptideRef>;
  /** blend peptideId → its BlendComponent rows (sortIndex order). Absent = not a known blend. */
  componentsByBlendId: Map<string, BlendComponentRef[]>;
}

/**
 * The three lookup maps every exposure surface needs to resolve a DoseLog to a
 * compound and expand blends. Shared by the analytics cumulative roll-up and
 * the body-composition interval ledger so the two cannot drift apart.
 *
 * BlendComponent is authoritative when populated; callers that need the static
 * library fallback (plasma chart) apply it themselves — the roll-up never does.
 */
export async function loadExposureMaps(userId: string): Promise<ExposureMaps> {
  const blendRows = await prisma.blendComponent.findMany({
    where: { peptide: { userId } },
    include: { componentPeptide: { select: { name: true, aliases: true, halfLifeHours: true } } },
    orderBy: { sortIndex: "asc" },
  });
  const componentsByBlendId = new Map<string, BlendComponentRef[]>();
  for (const r of blendRows) {
    const list = componentsByBlendId.get(r.peptideId) ?? [];
    list.push({
      name: r.componentPeptide.name,
      mg: Number(r.massMg.toString()),
      halfLifeHours: r.componentPeptide.halfLifeHours ? Number(r.componentPeptide.halfLifeHours.toString()) : null,
      aliases: r.componentPeptide.aliases ?? null,
      source: r.source,
    });
    componentsByBlendId.set(r.peptideId, list);
  }

  const protoPeptide = new Map<string, PeptideRef>(
    (await prisma.protocol.findMany({ where: { userId }, select: { id: true, peptideId: true, peptide: { select: { name: true } } } }))
      .map((p) => [p.id, { peptideId: p.peptideId, name: p.peptide.name }]),
  );
  const prepPeptide = new Map<string, PeptideRef>(
    (await prisma.preparation.findMany({
      where: { vial: { userId } },
      select: { id: true, vial: { select: { peptideId: true, peptide: { select: { name: true } } } } },
    })).map((p) => [p.id, { peptideId: p.vial.peptideId, name: p.vial.peptide.name }]),
  );

  return { prepPeptide, protoPeptide, componentsByBlendId };
}
