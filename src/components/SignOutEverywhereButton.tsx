"use client";

/**
 * "Sign out everywhere" — submits the `signOutEverywhere` server action (passed
 * in as a prop) after a confirm, since it revokes every active session by
 * bumping the owner's token version. Client component only for the confirm
 * dialog; the actual work runs server-side.
 */
export function SignOutEverywhereButton({
  action,
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Sign out of every device? You'll need to log in again everywhere.")) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="w-full rounded-control bg-surface px-4 py-3 text-sm font-medium text-danger ring-1 ring-line/10"
      >
        Sign out everywhere
      </button>
    </form>
  );
}
