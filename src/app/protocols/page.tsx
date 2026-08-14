import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { parseSchedule, scheduleSummary } from "@/lib/schedule/entries";
import { ProtocolEditor } from "@/components/ProtocolEditor";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { BackButton } from "@/components/BackButton";
import { PitstopHeading } from "@/components/PitstopHeading";
import { PAGE_MAIN } from "@/lib/layout";
import { deleteProtocol } from "@/app/actions/protocols";
import { compareStackGrouped } from "@/lib/stack-sort";
import { startOfDay } from "@/lib/schedule/schedule";
import { bucketOf, PROTOCOL_SECTIONS as SECTIONS, PROTOCOL_SECTION_ACCENT as SECTION_ACCENT } from "@/lib/protocol-bucket";
import { SignedOutNotice } from "@/components/SignedOutNotice";
import { cycleChip } from "@/lib/cycle/label";

export const dynamic = "force-dynamic";

function toDateInput(d: Date | null): string | null {
  if (!d) return null;
  return new Date(d).toISOString().slice(0, 10);
}

export default async function ProtocolsPage() {
  const user = await getCurrentUser();
  if (!user) return <SignedOutNotice />;

  const protocols = await prisma.protocol.findMany({
    where: { userId: user.id },
    include: { peptide: true, stack: true },
    orderBy: { name: "asc" },
  });
  const today = startOfDay(new Date());
  // Revisions of one course, oldest first, so each row can link to the protocol
  // it replaced. The list itself stays flat by design.
  const byCourse = new Map<string, { id: string; startDate: Date | null }[]>();
  for (const p of protocols) {
    const k = p.courseId ?? p.id;
    const arr = byCourse.get(k) ?? [];
    arr.push({ id: p.id, startDate: p.startDate });
    byCourse.set(k, arr);
  }
  // Ordered by startDate. Protocol has no createdAt to tiebreak with, so two
  // revisions of one course that BOTH lack a start date would fall back to query
  // order. reviseProtocol always sets one on the replacement, so that shape is
  // not reachable through the revise path — only by hand-editing both rows.
  for (const arr of byCourse.values()) {
    arr.sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));
  }
  const predecessorOf = (p: { id: string; courseId: string | null }) => {
    const arr = byCourse.get(p.courseId ?? p.id) ?? [];
    const i = arr.findIndex((x) => x.id === p.id);
    return i > 0 ? arr[i - 1] : null;
  };
  const sortedProtocols = [...protocols].sort((a, b) =>
    compareStackGrouped({
      stackId: a.stackId,
      stackName: a.stack?.name,
      peptideName: a.peptide.name,
      name: a.name,
    }, {
      stackId: b.stackId,
      stackName: b.stack?.name,
      peptideName: b.peptide.name,
      name: b.name,
    }),
  );

  return (
    <main className={PAGE_MAIN}>
      <BackButton fallback="/more" />
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <PitstopHeading title="Protocols" index={8} className="text-3xl font-semibold tracking-tight" split={["PROTO", "COLS"]} />
          <p className="text-muted">Set start dates, schedules, and pause or resume.</p>
        </div>
        <Link href="/protocols/new" className="shrink-0 rounded-control bg-accent px-3 py-2 text-sm font-medium text-onAccent">+ Add protocol</Link>
      </div>
      {SECTIONS.map(({ key, title, blurb }) => {
        const group = sortedProtocols.filter((p) => bucketOf(p, today) === key);
        if (group.length === 0) return null;
        return (
          <section key={key} className="mb-8">
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
                <span className={`h-2 w-2 rounded-full ${SECTION_ACCENT[key]}`} aria-hidden />
                {title}
                <span className="text-muted font-normal normal-case tracking-normal">({group.length})</span>
              </h2>
              <p className="text-xs text-muted">{blurb}</p>
            </div>
            <div className="grid gap-3 lg:grid-cols-2 min-[1440px]:grid-cols-3">
              {group.map((p) => (
                <div key={p.id}>
                  {/* Key on the server values so a cascade from a sibling save remounts
                      this card with fresh data — its useState would otherwise keep
                      showing (and on save, resend) the pre-cascade date. */}
                  <ProtocolEditor
                    key={`${p.id}:${toDateInput(p.startDate) ?? ""}:${p.status}`}
                    id={p.id}
                    name={p.name}
                    peptideName={p.peptide.name}
                    startDate={toDateInput(p.startDate)}
                    scheduleLabel={scheduleSummary(parseSchedule(p.scheduleRule))}
                    halfLifeHours={p.peptide.halfLifeHours?.toString() ?? null}
                    status={p.status as "active" | "paused" | "completed"}
                  />
                  {(() => {
                    // A revision replaced an earlier protocol in the same
                    // course — link back to the one it superseded. Null for the
                    // first (and for every unrevised, courseId-less) protocol.
                    const prev = predecessorOf(p);
                    if (!prev) return null;
                    return (
                      <Link
                        href={`/protocols/${prev.id}/edit`}
                        className="mt-1 inline-flex items-center rounded-full bg-line/[0.06] px-2 py-0.5 text-xs text-muted"
                      >
                        revised from earlier
                      </Link>
                    );
                  })()}
                  {(() => {
                    // Always-on cycle status (distinct from the dashboard's
                    // banner, which only fires near a boundary). Null when the
                    // protocol has no cycle plan — no empty chip.
                    const chip = cycleChip({
                      anchor: p.cycleAnchor ?? p.startDate,
                      onWeeks: p.cycleOnWeeks,
                      offWeeks: p.cycleOffWeeks,
                      today,
                    });
                    if (!chip) return null;
                    return (
                      <p
                        className={`mt-1 inline-flex items-center rounded-control px-2 py-0.5 text-xs ${
                          chip.tone === "warn" ? "bg-warn/10 text-warn" : "bg-bg text-muted ring-1 ring-line/15"
                        }`}
                      >
                        {chip.text}
                      </p>
                    );
                  })()}
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
          </section>
        );
      })}
    </main>
  );
}
