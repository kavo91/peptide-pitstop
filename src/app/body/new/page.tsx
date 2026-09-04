/**
 * /body/new — one converging entry page for a visit: the DEXA report upload card
 * and scan form, then the RMR form, as stacked sections. The upload card parses
 * the clinic PDF and can prefill the whole scan form; the form otherwise prefills
 * subject fields from the most recent scan. The RMR form links to (and inherits
 * from) a scan within ±1 day of the entered test date so the same values are
 * never asked twice; the server seeds that link from "now" and the form re-links
 * live as the date changes, so the form alone reports the link state.
 *
 * Reference only — not medical advice.
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/owner";
import { prisma } from "@/lib/db";
import { decNum } from "@/lib/bodycomp-data";
import { BackButton } from "@/components/BackButton";
import { PitstopHeading } from "@/components/PitstopHeading";
import type { ScanPrefill } from "@/components/BodyCompScanForm";
import { DexaEntry } from "@/components/DexaUploadCard";
import { MetabolicTestForm, type LinkedScan } from "@/components/MetabolicTestForm";
import { BODY_COPY } from "@/lib/bodycomp-copy";
import { activeDesign } from "@/lib/design";
import { PAGE_MAIN } from "@/lib/layout";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

const asSex = (s: string): "male" | "female" => (s === "female" ? "female" : "male");
const numStr = (n: number | null): string => (n == null ? "" : String(n));

export default async function BodyNewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const now = new Date();
  const [latest, near] = await Promise.all([
    prisma.bodyCompScan.findFirst({ where: { userId: user.id }, orderBy: { scannedAt: "desc" } }),
    prisma.bodyCompScan.findFirst({
      where: { userId: user.id, scannedAt: { gte: new Date(now.getTime() - DAY_MS), lte: new Date(now.getTime() + DAY_MS) } },
      orderBy: { scannedAt: "desc" },
    }),
  ]);

  // Prefill for the scan form: the subject block of the most recent scan (clinic weight is encrypted at rest).
  const prefill: ScanPrefill | null = latest
    ? { sex: asSex(latest.sex), ageYears: String(latest.ageYears), heightCm: String(latest.heightCm), clinicWeightKg: numStr(decNum(latest.clinicWeightKg)) }
    : null;

  // RMR link seed: a scan within ±1 day of now inherits sex/age/height/weight into the test.
  // The form re-links on date change and prints the live link line itself.
  const linkedScan: LinkedScan | null = near
    ? { id: near.id, localDay: near.localDay, sex: asSex(near.sex), ageYears: String(near.ageYears), heightCm: String(near.heightCm), clinicWeightKg: numStr(decNum(near.clinicWeightKg)) }
    : null;

  const design = activeDesign();

  return (
    <main className={PAGE_MAIN}>
      <BackButton fallback="/body" />

      <div className="mb-6">
        <PitstopHeading title="Body" index={12} design={design} className="mb-1 text-3xl font-semibold tracking-tight" split={["BO", "DY"]} />
        <p className="text-muted">
          Enter a DEXA scan and, if measured, the RMR test from the same visit.
          <span className="block text-xs">
            Answer the preparation items from the{" "}
            <Link href="/body/prep" className="font-medium text-accentStrong underline-offset-2 hover:underline">pre-visit checklist</Link>
            . Reference only — not medical advice.
          </span>
        </p>
      </div>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold text-ink">DEXA</h2>
        <DexaEntry prefill={prefill} />
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold text-ink">RMR</h2>
        <MetabolicTestForm linkedScan={linkedScan} />
      </section>

      <p className="text-xs text-muted">{BODY_COPY.disclaimer}</p>
    </main>
  );
}
