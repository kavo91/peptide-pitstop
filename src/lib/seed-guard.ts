/**
 * Guard for the destructive dev seed (`prisma/seed.ts`).
 *
 * The seed wipes every data table and resets the owner row to unprovisioned
 * (`passwordHash: ""`), which REOPENS `/setup` so the account can be re-claimed.
 * That is the intended DEV workflow, but catastrophic against the live prod DB:
 * it would both destroy data and let the next visitor claim the owner account.
 *
 * Prod must never seed (the entrypoint only runs `prisma migrate deploy`). This
 * guard is the defence-in-depth backstop: refuse to run when NODE_ENV=production
 * unless explicitly overridden with `ALLOW_PROD_SEED=1` (the one-time genuine
 * first-provision of a brand-new prod DB).
 */

type SeedEnv = { NODE_ENV?: string; ALLOW_PROD_SEED?: string };

/** True if the destructive seed is permitted to run in this environment. */
export function isSeedAllowed(env: SeedEnv): boolean {
  if (env.NODE_ENV === "production") return env.ALLOW_PROD_SEED === "1";
  return true;
}

/** Throw (fail closed) if the destructive seed must not run here. */
export function assertSeedAllowed(env: SeedEnv): void {
  if (isSeedAllowed(env)) return;
  throw new Error(
    "Refusing to run the destructive seed with NODE_ENV=production: it wipes all " +
      "data and resets owner credentials (reopening /setup). Set ALLOW_PROD_SEED=1 " +
      "to override — you almost never want this.",
  );
}
