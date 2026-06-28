/**
 * Inventory / Vials — every vial on hand, its preparation state, depletion
 * forecast, and beyond-use/expiry warnings. Unprepared vials open the recon
 * wizard inline. Server component; the wizard inside is a client component.
 */
import { getCurrentUser } from "@/lib/auth/owner";
import { getInventory, projectedSealedDoses, type VialView } from "@/lib/inventory";
import { getReorderStatus } from "@/lib/reorder";
import { prisma } from "@/lib/db";
import { ReconWizard } from "@/components/ReconWizard";
import { VialActions } from "@/components/VialActions";
import { VialPrescription } from "@/components/VialPrescription";
import { PitstopHeading } from "@/components/PitstopHeading";
import { VialGlyph, VialLevelBar, VialStatusChip, vialState, vialFill } from "@/components/VialGlyph";
import Link from "next/link";
import { PAGE_MAIN } from "@/lib/layout";

export const dynamic = "force-dynamic";

function PreparedVial({ v, pit }: { v: VialView; pit?: boolean }) {
  const low = v.daysLeft != null && v.daysLeft <= 7;
  return (
    <div className="border-t border-line/10 p-4">
      {pit && <VialLevelBar state={vialState(v)} fill={vialFill(v)} />}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Concentration</dt>
          <dd className="font-medium tabular-nums">{(Number(v.concentrationMcgPerMl) / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} mg/mL</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Remaining</dt>
          <dd className="font-medium tabular-nums">{Number(v.remainingMl).toFixed(2)} mL</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Doses left</dt>
          <dd className="font-medium tabular-nums">{v.remainingDoses != null ? `~${v.remainingDoses}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Runs out in</dt>
          <dd className={`font-medium tabular-nums ${low ? "text-warn" : ""}`}>{v.daysLeft != null ? `~${v.daysLeft} days` : "—"}</dd>
        </div>
      </dl>

      {v.beyondUseDate && (
        <p className={`mt-3 text-xs ${v.beyondUsePassed ? "text-danger" : "text-muted"}`}>
          {v.beyondUsePassed ? "⚠ Past beyond-use date" : "Use by"} {v.beyondUseDate}
        </p>
      )}
      {low && !v.beyondUsePassed && (
        <p className="mt-3 rounded-control bg-warn/10 px-3 py-2 text-xs font-medium text-warn">
          Low stock — reorder soon
        </p>
      )}
    </div>
  );
}

export default async function InventoryPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <PitstopHeading title="Inventory" index={5} className="text-3xl font-semibold tracking-tight" split={["INVEN", "TORY"]} />
        <p className="mt-4 text-muted">No data yet — run the seed.</p>
      </main>
    );
  }

  const vials = await getInventory(user.id);
  const reorder = (await getReorderStatus(user.id)).filter((r) => r.status === "reorder_now");

  // Logged-dose count per vial (across all its preparations) for the delete
  // impact prompt. One query over the user's preparations + their dose-log
  // counts; lookup by vialId — no N+1.
  const preps = await prisma.preparation.findMany({
    where: { vial: { userId: user.id } },
    select: { vialId: true, _count: { select: { doseLogs: true } } },
  });
  const doseCountByVial = new Map<string, number>();
  for (const p of preps) {
    doseCountByVial.set(p.vialId, (doseCountByVial.get(p.vialId) ?? 0) + p._count.doseLogs);
  }
  // Prescriptions grouped by peptide — drives the inline "link prescription"
  // picker on each vial (only the peptide's own scripts are offered).
  const prescriptionRows = await prisma.prescription.findMany({
    where: { userId: user.id },
    select: { id: true, peptideId: true, source: true, status: true },
    orderBy: { status: "asc" },
  });
  const prescriptionsByPeptide = new Map<string, { id: string; name: string }[]>();
  for (const r of prescriptionRows) {
    // A prescription may be per-stack (peptideId null) rather than per-peptide;
    // those don't belong in the per-peptide vial picker. Skip them (this also
    // narrows peptideId to string for the Map keys below).
    if (!r.peptideId) continue;
    const label = `${r.source ?? "Prescription"}${r.status !== "active" ? ` (${r.status})` : ""}`;
    const list = prescriptionsByPeptide.get(r.peptideId) ?? [];
    list.push({ id: r.id, name: label });
    prescriptionsByPeptide.set(r.peptideId, list);
  }

  const active = vials.filter((v) => v.status === "sealed" || v.status === "in_use");
  const inUse = active.filter((v) => v.prepared);
  const needsPrep = active.filter((v) => !v.prepared);
  const archived = vials.filter((v) => v.status === "finished" || v.status === "discarded");

  return (
    <main className={PAGE_MAIN}>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <PitstopHeading title="Inventory" index={5} className="text-3xl font-semibold tracking-tight" split={["INVEN", "TORY"]} />
            {reorder.length > 0 && (
              <span className="max-w-[40%] truncate rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent ring-1 ring-accent/40">
                Reorder · {reorder[0].peptideName}{reorder.length > 1 ? ` +${reorder.length - 1}` : ""}
              </span>
            )}
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Vials &amp; supplies · {active.length} active</p>
        </div>
        <Link href="/inventory/new" className="shrink-0 rounded-control bg-accent px-3 py-2 text-sm font-medium text-onAccent">+ Add vial</Link>
      </div>

      {reorder.length > 0 && (
        <section className="mb-6 rounded-card bg-warn/10 p-4 ring-1 ring-warn/20">
          <h2 className="mb-2 text-sm font-semibold text-warn">Reorder soon</h2>
          <ul className="space-y-2">
            {reorder.map((r) => (
              <li key={r.peptideId} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{r.peptideName}</span>
                <span className="text-right text-xs text-muted tabular-nums">
                  {r.coverageDays != null ? `~${r.coverageDays} days left` : ""}
                  {r.reorderByDate && <span className="block">order by {r.reorderByDate}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(() => {
        const dosesLogged = [...doseCountByVial.values()].reduce((a, b) => a + b, 0);
        const coverageDays = inUse
          .map((v) => v.daysLeft)
          .filter((d): d is number => d != null);
        const coverage = coverageDays.length > 0 ? `~${Math.min(...coverageDays)}d` : "—";
        return (
          <section className="mb-8">
            <div className="mb-3 flex items-center gap-2">
              <span className="uppercase tracking-[0.2em] text-[10px] text-muted">This cycle</span>
              <span className="h-px flex-1 bg-line/15" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-card bg-surface p-3 ring-1 ring-line/10">
                <div className="font-mono text-lg font-semibold tabular-nums">{dosesLogged}</div>
                <div className="uppercase text-[8.5px] tracking-[0.14em] text-muted">Doses logged</div>
              </div>
              <div className="rounded-card bg-surface p-3 ring-1 ring-line/10">
                <div className="font-mono text-lg font-semibold tabular-nums">{inUse.length}</div>
                <div className="uppercase text-[8.5px] tracking-[0.14em] text-muted">In use</div>
              </div>
              <div className="rounded-card bg-surface p-3 ring-1 ring-line/10">
                <div className="font-mono text-lg font-semibold tabular-nums">{coverage}</div>
                <div className="uppercase text-[8.5px] tracking-[0.14em] text-muted">Coverage</div>
              </div>
            </div>
          </section>
        );
      })()}

      {vials.length === 0 && <p className="text-muted">No vials yet.</p>}

      {/* In use — prepared vials, depletion info shown up front */}
      {inUse.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <span className="uppercase tracking-[0.2em] text-[10px] text-muted">In use</span>
            <span className="h-px flex-1 bg-line/15" />
            <span className="font-mono tabular-nums text-[10px] text-muted">{inUse.length} vial{inUse.length !== 1 ? "s" : ""}</span>
          </div>
          <ul className="grid gap-3 lg:grid-cols-2 lg:items-start min-[1900px]:grid-cols-3">
            {inUse.map((v) => (
              <li key={v.id} className="min-w-0 rounded-card bg-surface shadow-sm ring-1 ring-line/10">
                <div className="flex items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <VialGlyph state={vialState(v)} fill={vialFill(v)} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{v.peptideName}</p>
                      <p className="text-sm text-muted tabular-nums">
                        {Number(v.labelStrengthMg)} mg vial
                        {v.expiry && (
                          <span className={v.expired ? "text-danger" : ""}> · {v.expired ? "expired" : "exp"} {v.expiry}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {v.daysLeft != null && (
                      <div className={`flex items-baseline gap-0.5 font-mono tabular-nums leading-none ${v.daysLeft <= 7 ? "text-warn" : ""}`}>
                        <span className="text-2xl font-semibold">~{v.daysLeft}</span>
                        <span className="text-[11px] text-muted">d</span>
                      </div>
                    )}
                    <VialStatusChip state={vialState(v)} />
                  </div>
                </div>
                <details data-expand-mobile className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-1 border-t border-line/10 px-4 py-2 text-xs font-medium text-muted lg:hidden">
                    Details
                    <span aria-hidden className="transition-transform group-open:rotate-90">›</span>
                  </summary>
                  <PreparedVial v={v} pit />
                </details>
                {/* Vial actions live OUTSIDE <details> so Edit/Retire/Delete and
                    the ⋯ menu stay visible on mobile when the info dl is
                    collapsed. Desktop is unchanged — same border-t row position. */}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line/10 px-4 py-2">
                  <VialPrescription
                    vialId={v.id}
                    options={prescriptionsByPeptide.get(v.peptideId) ?? []}
                    current={v.prescriptionId ? { id: v.prescriptionId, label: v.prescriptionLabel ?? "Linked" } : null}
                  />
                  <VialActions id={v.id} hasPrep={v.prepared} doseCount={doseCountByVial.get(v.id) ?? 0} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Needs preparation — collapsed by default; expand to run the recon wizard */}
      {needsPrep.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <span className="uppercase tracking-[0.2em] text-[10px] text-muted">Needs preparation</span>
            <span className="h-px flex-1 bg-line/15" />
            <span className="font-mono tabular-nums text-[10px] text-muted">{needsPrep.length} vial{needsPrep.length !== 1 ? "s" : ""}</span>
          </div>
          <ul className="grid gap-3 lg:grid-cols-2 lg:items-start min-[1900px]:grid-cols-3">
            {needsPrep.map((v) => (
              <li key={v.id} className="min-w-0 rounded-card bg-surface shadow-sm ring-1 ring-line/10">
                <details>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <VialGlyph state="sealed" fill={0} />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{v.peptideName}</p>
                        <p className="text-sm text-muted tabular-nums">
                          {Number(v.labelStrengthMg)} mg vial · needs preparation
                          {v.expiry && (
                            <span className={v.expired ? "text-danger" : ""}> · {v.expired ? "expired" : "exp"} {v.expiry}</span>
                          )}
                        </p>
                        {(() => {
                          const doses = projectedSealedDoses({
                            labelStrengthMg: v.labelStrengthMg,
                            targetDose: v.recon?.targetDose,
                            targetUnit: v.recon?.targetUnit,
                          });
                          if (doses == null) return null;
                          return (
                            <p className="mt-0.5 font-mono text-[11px] tabular-nums" style={{ color: "#B14EFF" }}>
                              → ~{doses} dose{doses !== 1 ? "s" : ""} when prepared
                            </p>
                          );
                        })()}
                      </div>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <VialStatusChip state="sealed" />
                      <VialStatusChip state="prep" />
                    </span>
                  </summary>
                  <div className="border-t border-line/10 p-4">
                    <ReconWizard
                      vialId={v.id}
                      peptideName={v.peptideName}
                      labelStrengthMg={v.labelStrengthMg}
                      targetDose={v.recon?.targetDose}
                      targetUnit={v.recon?.targetUnit}
                      syringe={v.recon?.syringe}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line/10 px-4 py-2">
                    <VialPrescription
                      vialId={v.id}
                      options={prescriptionsByPeptide.get(v.peptideId) ?? []}
                      current={v.prescriptionId ? { id: v.prescriptionId, label: v.prescriptionLabel ?? "Linked" } : null}
                    />
                    <VialActions id={v.id} hasPrep={v.prepared} doseCount={doseCountByVial.get(v.id) ?? 0} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}

      {archived.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <span className="uppercase tracking-[0.2em] text-[10px] text-muted">Finished</span>
            <span className="h-px flex-1 bg-line/15" />
            <span className="font-mono tabular-nums text-[10px] text-muted">{archived.length} vial{archived.length !== 1 ? "s" : ""}</span>
          </div>
          <ul className="space-y-2">
            {archived.map((v) => (
              <li key={v.id} className="flex items-center justify-between rounded-control bg-surface px-4 py-3 text-sm ring-1 ring-line/10">
                <span className="flex min-w-0 items-center gap-2 text-muted">
                  <VialGlyph state="finished" fill={0} className="!h-8 !w-auto" />
                  <span className="truncate">{v.peptideName} · {Number(v.labelStrengthMg)} mg</span>
                </span>
                <VialStatusChip state="finished" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
