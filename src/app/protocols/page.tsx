import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { parseSchedule, scheduleSummary } from "@/lib/schedule/entries";
import { ProtocolEditor } from "@/components/ProtocolEditor";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { BackButton } from "@/components/BackButton";
import { PitstopHeading } from "@/components/PitstopHeading";
import { activeDesign } from "@/lib/design";
import { PAGE_MAIN } from "@/lib/layout";
import { deleteProtocol } from "@/app/actions/protocols";

export const dynamic = "force-dynamic";

function toDateInput(d: Date | null): string | null {
  if (!d) return null;
  return new Date(d).toISOString().slice(0, 10);
}

export default async function ProtocolsPage() {
  const user = await getCurrentUser();
  if (!user) return <main className="mx-auto max-w-md px-4 py-10"><p className="text-muted">No data yet — run the seed.</p></main>;

  const protocols = await prisma.protocol.findMany({
    where: { userId: user.id },
    include: { peptide: true },
    orderBy: { name: "asc" },
  });

  return (
    <main className={PAGE_MAIN}>
      <BackButton fallback="/more" />
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <PitstopHeading title="Protocols" index={8} design={activeDesign()} className="text-3xl font-semibold tracking-tight" split={["PROTO", "COLS"]} />
          <p className="text-muted">Set start dates, schedules, and pause or resume.</p>
        </div>
        <Link href="/protocols/new" className="shrink-0 rounded-control bg-accent px-3 py-2 text-sm font-medium text-onAccent">+ Add protocol</Link>
      </div>
      <div className="grid gap-3 lg:grid-cols-2 min-[1440px]:grid-cols-3">
        {protocols.map((p) => (
          <div key={p.id}>
            <ProtocolEditor
              id={p.id}
              name={p.name}
              peptideName={p.peptide.name}
              startDate={toDateInput(p.startDate)}
              scheduleLabel={scheduleSummary(parseSchedule(p.scheduleRule))}
              halfLifeHours={p.peptide.halfLifeHours?.toString() ?? null}
              status={p.status as "active" | "paused" | "completed"}
            />
            <div className="mt-1 flex items-center justify-between gap-3">
              <ConfirmDeleteButton
                action={deleteProtocol}
                id={p.id}
                ariaLabel={`Delete ${p.name}`}
                confirmMessage="Delete this protocol? Logged doses are kept; planned doses and titration steps are removed."
              />
              <Link href={`/protocols/${p.id}/edit`} className="text-xs font-medium text-accentStrong">Full edit &amp; titration steps →</Link>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
