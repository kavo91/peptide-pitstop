import { redirect } from "next/navigation";
import { isProvisioned } from "@/lib/auth/owner";
import { LoginForm } from "@/components/LoginForm";
import { LogoMark } from "@/components/Logo";
import { brandName } from "@/lib/design";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  if (!(await isProvisioned())) redirect("/setup");
  const next = searchParams.next && searchParams.next.startsWith("/") ? searchParams.next : "/";
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
        <LogoMark size={44} />
        {brandName()}
      </h1>
      <p className="mt-1 text-muted">Sign in.</p>
      <LoginForm next={next} />
    </main>
  );
}
