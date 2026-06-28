import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isProvisioned } from "@/lib/auth/owner";
import { setupTokenRequired, SETUP_TOKEN_COOKIE } from "@/lib/auth/setupToken";
import { SetupForm } from "@/components/SetupForm";

export const dynamic = "force-dynamic";

/**
 * Stash the submitted setup token in a short-lived cookie so `finishSetup` can
 * read it. The token is NOT validated here (no oracle on this page) — the gate
 * is enforced server-side in the action. Keeps the existing client SetupForm
 * untouched.
 */
async function saveSetupToken(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  cookies().set(SETUP_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE !== "false",
    path: "/",
    maxAge: 60 * 15, // 15 min — only needs to survive the setup flow
  });
  redirect("/setup");
}

export default async function SetupPage({
  searchParams,
}: {
  searchParams?: { token?: string };
}) {
  if (await isProvisioned()) redirect("/login");

  const tokenRequired = setupTokenRequired();
  // A `?token=` query param prefills (and pre-stages) the field. We do NOT echo
  // back whether it was correct — only whether a token is required at all.
  const prefill = searchParams?.token ?? "";
  const tokenStaged = Boolean(cookies().get(SETUP_TOKEN_COOKIE)?.value);

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Set up your account</h1>
      <p className="mt-1 text-muted">One-time setup for this device.</p>

      {tokenRequired && (
        <form action={saveSetupToken} className="mt-6 space-y-3">
          <label className="block text-sm text-muted">
            Setup token
            <input
              type="password"
              name="token"
              defaultValue={prefill}
              autoComplete="off"
              placeholder="Required to set up this instance"
              className="mt-1 w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-ink"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-control border border-line/15 bg-bg px-4 py-2 text-sm font-medium text-ink"
          >
            {tokenStaged ? "Update token" : "Use token"}
          </button>
          <p className="text-xs text-muted">
            This instance requires a setup token. Enter the value of{" "}
            <code>SETUP_TOKEN</code> to continue.
          </p>
        </form>
      )}

      <SetupForm />
    </main>
  );
}
