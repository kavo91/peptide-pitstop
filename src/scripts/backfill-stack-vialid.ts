/**
 * Backfill Protocol.vialId for LEGACY stack protocols.
 *
 * Stacks created before the pinned-vial column existed have protocols with
 * `stackId` set but `vialId` null, so stack resolution falls back to peptideId
 * (getStacks / logStack / stackComponentVialIds). This one-off script pins each
 * such protocol to the SAME vial createStack would have pinned: the user's
 * in-use vial for that peptide carrying an active premixed Preparation.
 *
 * Conservative by design: pins ONLY when there is exactly one such candidate
 * vial. Zero or multiple candidates → SKIP (never guesses).
 *
 * Idempotent: only scans protocols still missing a vialId, so re-running after a
 * successful apply is a no-op. Read-only unless --apply is passed.
 *
 * Usage (tsx — same runner as `prisma/seed.ts`; no compile step):
 *   tsx src/scripts/backfill-stack-vialid.ts            # dry-run (default, no writes)
 *   tsx src/scripts/backfill-stack-vialid.ts --dry-run  # explicit dry-run
 *   tsx src/scripts/backfill-stack-vialid.ts --apply     # persist the pins
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const dryRun = !apply; // --dry-run is the default; only --apply writes.

  console.log(`backfill-stack-vialid: ${apply ? "APPLY (writes enabled)" : "DRY-RUN (no writes)"}`);

  // Legacy stack protocols: grouped under a stack but missing the pinned vial.
  const protocols = await prisma.protocol.findMany({
    where: { stackId: { not: null }, vialId: null },
    select: { id: true, userId: true, peptideId: true, stackId: true, peptide: { select: { name: true } } },
    orderBy: { id: "asc" },
  });

  let scanned = 0;
  let pinned = 0;
  let skippedAmbiguous = 0;
  let skippedNone = 0;

  for (const p of protocols) {
    scanned++;
    const peptideName = p.peptide?.name ?? "(unknown peptide)";

    // Mirror createStack's pin: the user's in-use vial for this peptide that
    // carries an active PREMIXED preparation. Collect the DISTINCT candidate
    // vials so multiple matches are flagged ambiguous rather than guessed.
    const preps = await prisma.preparation.findMany({
      where: {
        active: true,
        prepType: "premixed",
        vial: { userId: p.userId, peptideId: p.peptideId, status: "in_use" },
      },
      select: { vialId: true },
    });
    const candidateVialIds = [...new Set(preps.map((x) => x.vialId))];

    if (candidateVialIds.length === 1) {
      const vialId = candidateVialIds[0];
      pinned++;
      console.log(
        `  PIN   protocol=${p.id} stack=${p.stackId} peptide="${peptideName}" -> vial=${vialId}${dryRun ? " (dry-run, not written)" : ""}`,
      );
      if (apply) {
        // Re-assert vialId: null in the filter so a concurrent run can't double-write.
        const res = await prisma.protocol.updateMany({ where: { id: p.id, vialId: null }, data: { vialId } });
        if (res.count !== 1) {
          console.warn(`  WARN  protocol=${p.id} update affected ${res.count} rows (expected 1) — already pinned?`);
        }
      }
    } else if (candidateVialIds.length === 0) {
      skippedNone++;
      console.warn(
        `  SKIP  protocol=${p.id} stack=${p.stackId} peptide="${peptideName}" — no in-use vial with an active premixed prep`,
      );
    } else {
      skippedAmbiguous++;
      console.warn(
        `  SKIP  protocol=${p.id} stack=${p.stackId} peptide="${peptideName}" — ambiguous: ${candidateVialIds.length} candidate vials [${candidateVialIds.join(", ")}]`,
      );
    }
  }

  console.log("----------------------------------------");
  console.log(`scanned:            ${scanned}`);
  console.log(`pinned:             ${pinned}${dryRun ? " (would pin — dry-run)" : ""}`);
  console.log(`skipped (ambiguous): ${skippedAmbiguous}`);
  console.log(`skipped (none):      ${skippedNone}`);
  if (dryRun && pinned > 0) {
    console.log("Re-run with --apply to persist the pins above.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
