import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/owner";
import { prisma } from "@/lib/db";
import { getPeptideOptions, getPrescriptionOptions, getSyringeOptions } from "@/lib/options";
import { ProtocolForm } from "@/components/ProtocolForm";
import { getEnrichment, tokens } from "@/lib/peptide-enrichment";
import { effectiveTemplates } from "@/lib/enrichment/suggested-protocol";
import { protocolTemplateToInput, templateToRampSteps } from "@/lib/protocol-template";
import type { ProtocolInput } from "@/app/actions/protocols";

export const dynamic = "force-dynamic";

export default async function NewProtocolPage({
  searchParams,
}: {
  searchParams: { template?: string; ti?: string; peptideId?: string };
}) {
  const user = await getCurrentUser();
  if (!user) return null;

  const sp = searchParams;

  // One protocol per peptide — only offer peptides that don't already have one.
  const taken = new Set((await prisma.protocol.findMany({ where: { userId: user.id }, select: { peptideId: true } })).map((p) => p.peptideId));
  const peptides = (await getPeptideOptions(user.id)).filter((p) => !taken.has(p.id));
  const prescriptions = await getPrescriptionOptions(user.id);
  const syringes = await getSyringeOptions(user.id);

  // Optional template prefill: ?template=<peptideName>&ti=<index>&peptideId=<id>.
  // Resolve the enrichment entry → the chosen template → the user's matching
  // peptide id → the mapped ProtocolInput. Any miss falls through to a blank form
  // with a hint; never crash.
  let template: ProtocolInput | undefined;
  let templateRamp: { phase: string; doseLabel: string }[] | undefined;
  let missingHint: string | null = null;

  if (sp.template) {
    const entry = await getEnrichment(sp.template);
    const ti = Number.parseInt(sp.ti ?? "0", 10);
    // Guard a corrupt PeptideReference row: `templates` may not be an array, and
    // `ti` may be out of range. Either case → no template (blank form + hint),
    // never an index-into-non-array crash. Resolve against effectiveTemplates so
    // flat-dosed peptides (e.g. GHK-Cu) offer their synthesized suggested protocol.
    const templates = entry && Array.isArray(entry.templates) ? effectiveTemplates(entry) : [];
    const tmpl = Number.isInteger(ti) && ti >= 0 && ti < templates.length ? templates[ti] : undefined;

    if (entry && tmpl) {
      // Resolve the peptide id: prefer the explicit param (validated against the
      // user's peptides), else match by name/alias. Must be a still-available
      // peptide (not already protocoled) to be applied.
      const all = await prisma.peptide.findMany({
        where: { OR: [{ userId: user.id }, { userId: null }] },
        select: { id: true, name: true, aliases: true },
      });
      const want = tokens(entry.name, entry.aliases);
      const byName = all.find((p) => tokens(p.name, p.aliases ?? undefined).some((t) => want.includes(t)));
      const candidateId = (sp.peptideId && all.some((p) => p.id === sp.peptideId)) ? sp.peptideId : byName?.id;

      if (candidateId && peptides.some((p) => p.id === candidateId)) {
        template = protocolTemplateToInput(tmpl, candidateId);
        const ramp = tmpl.ramp ?? [];
        if (templateToRampSteps(tmpl) && ramp.length > 0) {
          templateRamp = ramp.map((r) => ({ phase: r.phase, doseLabel: r.doseLabel }));
        }
      } else if (candidateId && taken.has(candidateId)) {
        missingHint = `${entry.name} already has a protocol — edit it from Protocols instead.`;
      } else {
        missingHint = `Add ${entry.name} from the library in Settings first, then apply this template.`;
      }
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8 lg:max-w-2xl lg:px-8">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">New protocol</h1>
      {missingHint && (
        <p className="mb-4 rounded-card bg-surface p-3 text-sm text-muted shadow-sm ring-1 ring-line/10">{missingHint}</p>
      )}
      {peptides.length === 0 ? (
        <p className="text-muted">Every peptide already has a protocol. Edit an existing one from <Link href="/protocols" className="font-medium text-accentStrong">Protocols</Link>, or add a new peptide in Settings first.</p>
      ) : (
        <ProtocolForm peptides={peptides} prescriptions={prescriptions} syringes={syringes} template={template} templateRamp={templateRamp} />
      )}
    </main>
  );
}
