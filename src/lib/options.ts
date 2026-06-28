/**
 * Shared option-loaders for the CRUD forms (peptide / prescription / syringe
 * pickers). Extracted to one place so every form queries identically — the
 * earlier copy-paste drift is what hid the /log "shared syringes" bug.
 */
import "server-only";
import { prisma } from "@/lib/db";

export interface Option {
  id: string;
  name: string;
}

/** Peptides the user can use (their own + the shared library). */
export async function getPeptideOptions(userId: string): Promise<Option[]> {
  const rows = await prisma.peptide.findMany({ where: { OR: [{ userId }, { userId: null }] }, orderBy: { name: "asc" } });
  return rows.map((p) => ({ id: p.id, name: p.name }));
}

/** Prescriptions, labelled "<peptide> · <source>". */
export async function getPrescriptionOptions(userId: string): Promise<Option[]> {
  const rows = await prisma.prescription.findMany({ where: { userId }, include: { peptide: true, stack: true }, orderBy: { status: "asc" } });
  return rows.map((r) => ({ id: r.id, name: `${r.peptide?.name ?? r.stack?.name ?? "Prescription"}${r.source ? ` · ${r.source}` : ""}` }));
}

/** Syringes the user can use (their own + the shared library). */
export async function getSyringeOptions(userId: string): Promise<Option[]> {
  const rows = await prisma.syringe.findMany({ where: { OR: [{ userId }, { userId: null }] }, orderBy: { name: "asc" } });
  return rows.map((s) => ({ id: s.id, name: s.name }));
}
