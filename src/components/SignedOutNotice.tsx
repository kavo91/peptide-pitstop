import Link from "next/link";

/**
 * Shown on any page reached without a session.
 *
 * These call sites previously each said "No data yet — run the seed" (and the
 * dashboard, "No owner account yet. Run npm run db:seed to load your regimen").
 * That reads as a missing-data problem and sends you digging through the
 * database when you are simply signed out — which is exactly what happened when
 * a stale authenticator entry locked us out of the QA instance. The distinction
 * matters more for self-hosters, where "run the seed" is a plausible-sounding
 * instruction that would do nothing.
 */
export function SignedOutNotice() {
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Not signed in</h1>
      <p className="mt-3 text-muted">Sign in to view this page.</p>
      <Link
        href="/login"
        className="mt-5 inline-block rounded-control bg-accent px-4 py-2 text-sm font-medium text-onAccent"
      >
        Sign in
      </Link>
    </main>
  );
}
