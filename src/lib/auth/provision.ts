/**
 * First-run owner provisioning. Kept free of `server-only`/Prisma imports so the
 * atomic guard can be unit-tested with a fake; the real `prisma.user.updateMany`
 * is injected by the setup server action.
 */

/** The single DB capability provisioning needs: a guarded batch update. */
export type ProvisionUpdate = (args: {
  where: { role: string; passwordHash: string };
  data: { passwordHash: string; totpSecret: string | null };
}) => Promise<{ count: number }>;

/**
 * Atomically claim the unprovisioned owner row. The guard `passwordHash: ""`
 * lives INSIDE the single UPDATE statement, so two concurrent setup submissions
 * (a TOCTOU race) can never both succeed: the DB matches exactly one row, the
 * winner sees `count === 1` and the loser `count === 0`. Any count other than 1
 * means the owner was already provisioned (or is missing) — reject.
 */
export async function provisionOwner(
  updateMany: ProvisionUpdate,
  passwordHash: string,
  encryptedSecret: string | null,
): Promise<void> {
  const { count } = await updateMany({
    where: { role: "owner", passwordHash: "" },
    data: { passwordHash, totpSecret: encryptedSecret },
  });
  if (count !== 1) throw new Error("already provisioned");
}
