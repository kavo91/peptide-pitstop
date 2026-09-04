import { BODY_COPY } from "@/lib/bodycomp-copy";

/** Standing footer — fixed copy, the same text the doctor-report PDF will reuse. */
export function BodyFooter() {
  return (
    <p id="disclaimer" className="mt-8 text-center text-xs text-muted">
      {BODY_COPY.disclaimer}
    </p>
  );
}
