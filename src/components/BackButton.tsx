"use client";

/**
 * Back affordance for secondary screens (those reached from More or from a
 * link rather than the bottom tab bar). Uses real history when there is any,
 * so a screen reachable from multiple places returns to wherever you came
 * from; falls back to a fixed href on a direct/cold load.
 */
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

export function BackButton({ fallback = "/more", label = "Back" }: { fallback?: string; label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push(fallback);
      }}
      className="mb-3 -ml-1 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink lg:hidden"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden /> {label}
    </button>
  );
}
