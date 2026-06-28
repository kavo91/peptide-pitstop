/**
 * Server-only helpers tying the session to the owner User row. Single-owner
 * model: provisioning state is derived from whether passwordHash is set.
 */
import "server-only";
import { prisma } from "@/lib/db";
import { getSession, sessionTokenVersionValid } from "./session";

export async function getOwner() {
  return prisma.user.findFirst({ where: { role: "owner" } });
}

/** Provisioned = an owner exists and has set a password. */
export async function isProvisioned(): Promise<boolean> {
  const owner = await getOwner();
  return Boolean(owner && owner.passwordHash !== "");
}

/** The authenticated user, or null (also null if the session has been revoked). */
export async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.uid } });
  if (!user) return null;
  // Reject sessions revoked via "Sign out everywhere" (tokenVersion bumped).
  if (!sessionTokenVersionValid(session, user.tokenVersion)) return null;
  return user;
}
