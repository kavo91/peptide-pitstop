import "server-only";
/**
 * Abandoned uploads. `uploadDexaReport` stores the PDF and its `Document` row
 * before the user confirms anything; a visit left without Save or Discard used
 * to keep both forever. The entry page discards on unmount (in-app navigation);
 * this sweep is the safety net for closed tabs and crashes: unreferenced
 * report rows older than the TTL are removed, row first, file after.
 *
 * `ecg_report` uploads are swept too. That path saves or cleans up inside one
 * action, so it only ever leaves an orphan if the process dies mid-import —
 * which is exactly the case a safety net is for.
 */
import { prisma } from "@/lib/db";
import { deleteDocumentFile } from "@/lib/documents";

/** Long enough that a slow manual entry in an open tab never loses its attached report. */
export const ORPHAN_DOCUMENT_TTL_MS = 24 * 60 * 60 * 1000;

/** Remove this user's unreferenced report uploads older than the TTL. Returns the number removed; never throws for one bad row. */
export async function sweepOrphanDocuments(userId: string, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ORPHAN_DOCUMENT_TTL_MS);
  const orphans = await prisma.document.findMany({
    where: {
      userId,
      kind: { in: ["dexa_report", "ecg_report"] },
      uploadedAt: { lt: cutoff },
      bodyCompScans: { none: {} },
      metabolicTests: { none: {} },
      ecgRecordings: { none: {} },
      prescriptions: { none: {} },
      labPanels: { none: {} },
    },
    select: { id: true, filePath: true, kind: true, extractionStatus: true },
  });
  let removed = 0;
  for (const doc of orphans) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.document.delete({ where: { id: doc.id } });
        await tx.auditLog.create({
          data: { userId, entityType: "Document", entityId: doc.id, field: "sweep", oldValue: `${doc.kind} ${doc.extractionStatus} (abandoned upload)` },
        });
      });
    } catch (e) {
      console.error("sweepOrphanDocuments: row delete failed", e);
      continue;
    }
    // File after commit: a failed unlink leaves an orphan file, never a dangling row.
    await deleteDocumentFile(doc.filePath).catch((e) => console.error("sweepOrphanDocuments: unlink failed", e));
    removed++;
  }
  return removed;
}
