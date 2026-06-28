/**
 * Prescriptions — source, pharmacy, cost, refills, expiry, and reorder timing.
 * Encrypted free-text (prescriber/pharmacy/dose instructions) is decrypted at
 * read time via the field-encryption layer; never queried on.
 */
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { decryptField } from "@/lib/crypto/fieldEncryption";
import { BackButton } from "@/components/BackButton";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { PitstopHeading } from "@/components/PitstopHeading";
import { activeDesign } from "@/lib/design";
import { PAGE_MAIN } from "@/lib/layout";
import { deletePrescription } from "@/app/actions/prescriptions";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null): string | null {
  return d ? new Date(d).toISOString().slice(0, 10) : null;
}

function fmtMoney(cost: unknown, currency: string | null): string | null {
  if (cost == null) return null;
  const n = Number(cost.toString());
  if (!Number.isFinite(n)) return null;
  return `${currency ?? ""} ${n.toFixed(2)}`.trim();
}

const STATUS_STYLE: Record<string, string> = {
  active: "bg-ok/10 text-ok",
  expired: "bg-danger/10 text-danger",
  cancelled: "bg-line/[0.06] text-muted",
};

export default async function PrescriptionsPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <PitstopHeading title="Prescriptions" index={9} design={activeDesign()} className="text-3xl font-semibold tracking-tight" split={["PRE", "SCRIPTIONS"]} />
        <p className="mt-4 text-muted">No data yet — run the seed.</p>
      </main>
    );
  }

  const rxs = await prisma.prescription.findMany({
    where: { userId: user.id },
    include: { peptide: true, stack: { include: { protocols: { include: { peptide: true } } } } },
    orderBy: [{ status: "asc" }, { expiration: "asc" }],
  });

  const now = new Date();

  return (
    <main className={PAGE_MAIN}>
      <BackButton />
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <PitstopHeading title="Prescriptions" index={9} design={activeDesign()} className="text-3xl font-semibold tracking-tight" split={["PRE", "SCRIPTIONS"]} />
          <p className="text-muted">Refills, cost, expiry, and reorder reminders.</p>
        </div>
        <Link href="/prescriptions/new" className="shrink-0 rounded-control bg-accent px-3 py-2 text-sm font-medium text-onAccent">+ Add prescription</Link>
      </div>

      {rxs.length === 0 && <p className="text-muted">No prescriptions yet.</p>}

      <ul className="grid gap-3 lg:grid-cols-2 min-[1440px]:grid-cols-3">
        {rxs.map((rx) => {
          const prescriber = decryptField(rx.prescriber);
          const pharmacy = decryptField(rx.pharmacy);
          const instructions = decryptField(rx.doseInstructions);
          const cost = fmtMoney(rx.cost, rx.currency);
          const nextRefill = fmtDate(rx.nextRefill);
          const expiry = fmtDate(rx.expiration);
          const expired = rx.expiration ? new Date(rx.expiration) < now : false;
          const refillSoon = rx.nextRefill ? new Date(rx.nextRefill) <= new Date(now.getTime() + 7 * 86_400_000) : false;

          return (
            <li key={rx.id} className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  {rx.stack ? (
                    <>
                      <p className="font-medium">{rx.stack.name} <span className="text-xs font-normal text-muted">· stack</span></p>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {rx.stack.protocols.map((pr) => (
                          <span key={pr.id} className="rounded-full bg-bg px-2 py-0.5 text-xs text-muted ring-1 ring-line/15">{pr.peptide.name}</span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="font-medium">{rx.peptide?.name ?? "Prescription"}</p>
                  )}
                  <p className="mt-0.5 text-sm text-muted">{rx.source ?? prescriber ?? pharmacy ?? "—"}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${STATUS_STYLE[rx.status] ?? "bg-line/[0.06] text-muted"}`}>
                  {rx.status}
                </span>
              </div>

              {/* Mobile-only copy of the refill banner so it stays visible above
                  the collapsed details. lg:hidden keeps it off desktop, where the
                  in-flow copy inside <details> renders in its original position. */}
              {refillSoon && !expired && (
                <p className="mt-3 rounded-control bg-warn/10 px-3 py-2 text-xs font-medium text-warn lg:hidden">
                  Refill due soon — reorder to avoid a gap
                </p>
              )}

              <details data-expand-mobile className="group">
                <summary className="mt-2 flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted lg:hidden">
                  Details
                  <span aria-hidden className="transition-transform group-open:rotate-90">›</span>
                </summary>

                {instructions && <p className="mt-2 text-sm">{instructions}</p>}

                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted">Refills left</dt>
                    <dd className="font-medium tabular-nums">
                      {rx.refillsRemaining ?? "—"}
                      {rx.refillsAuthorized != null && <span className="text-muted"> / {rx.refillsAuthorized}</span>}
                    </dd>
                  </div>
                  {cost && (
                    <div>
                      <dt className="text-xs text-muted">Cost</dt>
                      <dd className="font-medium tabular-nums">{cost}</dd>
                    </div>
                  )}
                  {nextRefill && (
                    <div>
                      <dt className="text-xs text-muted">Next refill</dt>
                      <dd className={`font-medium tabular-nums ${refillSoon ? "text-warn" : ""}`}>{nextRefill}</dd>
                    </div>
                  )}
                  {expiry && (
                    <div>
                      <dt className="text-xs text-muted">Script expires</dt>
                      <dd className={`font-medium tabular-nums ${expired ? "text-danger" : ""}`}>{expiry}</dd>
                    </div>
                  )}
                  {pharmacy && (
                    <div className="col-span-2">
                      <dt className="text-xs text-muted">Pharmacy</dt>
                      <dd className="font-medium">{pharmacy}</dd>
                    </div>
                  )}
                </dl>

                {/* In-flow banner: desktop renders it here (original position,
                    byte-identical); on mobile it collapses with the details and
                    the lg:hidden copy above takes over. */}
                {refillSoon && !expired && (
                  <p className="mt-3 rounded-control bg-warn/10 px-3 py-2 text-xs font-medium text-warn">
                    Refill due soon — reorder to avoid a gap
                  </p>
                )}
              </details>

              {/* Action footer lives OUTSIDE <details> so Edit/Delete stay
                  visible on mobile even when the info detail is collapsed.
                  Desktop is unchanged: globals force-shows the details body at
                  lg and this row keeps its original mt-3 spacing below it. */}
              <div className="mt-3 flex items-center justify-between gap-3">
                {rx.stack ? (
                  <>
                    <span />
                    <Link href="/settings" className="text-xs font-medium text-accentStrong">Edit on stack</Link>
                  </>
                ) : (
                  <>
                    <ConfirmDeleteButton
                      action={deletePrescription}
                      id={rx.id}
                      ariaLabel="Delete this prescription"
                      confirmMessage="Delete this prescription? Linked vials and protocols are kept and just unlinked."
                    />
                    <Link href={`/prescriptions/${rx.id}/edit`} className="text-xs font-medium text-accentStrong">Edit</Link>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
