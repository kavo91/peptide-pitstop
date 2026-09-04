/**
 * /body/prep — printable pre-visit checklist. The prep booleans on the entry
 * forms are answered from this plan, not from memory. Static content (spec §4);
 * no data is read or written here.
 *
 * Reference only — not medical advice.
 */
import Link from "next/link";
import { BackButton } from "@/components/BackButton";
import { PitstopHeading } from "@/components/PitstopHeading";
import { BODY_COPY } from "@/lib/bodycomp-copy";
import { activeDesign } from "@/lib/design";
import { PAGE_MAIN } from "@/lib/layout";

export const dynamic = "force-dynamic";

interface Group { title: string; sub: string; items: string[] }

const GROUPS: Group[] = [
  {
    title: "Same setup as the last scan",
    sub: "Anything that differs demotes the comparison.",
    items: [
      "Same machine — check the device serial on the report",
      "Same software version",
      "Same technologist, if the clinic can arrange it",
      "Same positioning protocol (ask the clinic to follow their last-visit notes)",
    ],
  },
  {
    title: "The 48 hours before",
    sub: "Presentation noise moves lean more than the scanner does.",
    items: [
      "Normal carbohydrate intake — no loading, no depletion",
      "Creatine unchanged — same dose as the previous month, or none both times",
      "Same secretagogue state as the last scan — same compounds, similar days since the last dose",
      "No illness in the 14 days before (fever, infection, gut illness)",
    ],
  },
  {
    title: "The morning of",
    sub: "Book the earliest slot; the scan is a snapshot of the body's water as much as its tissue.",
    items: [
      "Morning appointment",
      "12 h fasted — water only",
      "No caffeine",
      "No training in the previous 24 h",
      "No active travel to the clinic — no cycling or long walk",
      "Normal fluids the day before; bladder emptied just before the scan",
      "Remove metal: jewellery, belt, zips, underwired garments",
    ],
  },
  {
    title: "RMR extras",
    sub: "Only if a metabolic test is booked on the same visit.",
    items: [
      "Rest 20–30 minutes seated or lying before the mask goes on",
      "Awake and still during the test — no talking, reading or dozing",
      "Ask for the printed VO2 (mL/min) and the steady-state CV %",
      "Ask which equation and activity factor the clinic used for its predicted numbers",
    ],
  },
  {
    title: "Ask the clinic",
    sub: "Replaces every assumed noise band with a measured one.",
    items: [
      "A same-day repositioned duplicate scan (get off the table, get back on, scan again)",
      "A next-morning repeat under the same preparation",
      "The site's own precision figures (CV %) for fat, lean and BMD, if they have them",
    ],
  },
];

export default function BodyPrepPage() {
  const design = activeDesign();
  return (
    <main className={`${PAGE_MAIN} body-prep`}>
      {/* Print: drop chrome, force a light page, keep the boxes as boxes. */}
      <style>{`
        @media print {
          .body-prep { max-width: none; padding: 0; }
          .body-prep .no-print, nav, header, footer { display: none !important; }
          .body-prep, .body-prep * { background: #fff !important; color: #000 !important; box-shadow: none !important; }
          .body-prep .prep-card { border: 1px solid #000; break-inside: avoid; page-break-inside: avoid; margin-bottom: 12pt; }
          .body-prep .prep-box { border: 1px solid #000; }
          a[href]::after { content: none !important; }
        }
      `}</style>

      <div className="no-print">
        <BackButton fallback="/body" />
      </div>

      <div className="mb-6">
        <PitstopHeading title="Body" index={12} design={design} className="mb-1 text-3xl font-semibold tracking-tight" split={["BO", "DY"]} />
        <h2 className="text-lg font-semibold text-ink">Pre-visit checklist</h2>
        <p className="text-muted">
          Print this before a DEXA or RMR visit and tick it on the day. The entry form asks the same questions —
          answer them from this sheet, not from memory.
        </p>
        <p className="no-print mt-2 text-xs text-muted">
          Use your browser&apos;s print command (⌘P / Ctrl+P). Then enter the visit at{" "}
          <Link href="/body/new" className="font-medium text-accentStrong underline-offset-2 hover:underline">Body → New</Link>.
        </p>
      </div>

      <div className="prep-card mb-4 rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <p className="flex items-center gap-2"><span className="prep-box inline-block h-4 w-4 shrink-0 rounded-sm ring-1 ring-line/40" aria-hidden />Visit date: <span className="text-muted">____________</span></p>
          <p className="flex items-center gap-2"><span className="prep-box inline-block h-4 w-4 shrink-0 rounded-sm ring-1 ring-line/40" aria-hidden />Clinic: <span className="text-muted">____________</span></p>
          <p className="flex items-center gap-2"><span className="prep-box inline-block h-4 w-4 shrink-0 rounded-sm ring-1 ring-line/40" aria-hidden />Hours fasted at scan: <span className="text-muted">______</span></p>
          <p className="flex items-center gap-2"><span className="prep-box inline-block h-4 w-4 shrink-0 rounded-sm ring-1 ring-line/40" aria-hidden />Days since last secretagogue dose: <span className="text-muted">______</span></p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title} className="prep-card rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
            <h3 className="font-semibold text-ink">{g.title}</h3>
            <p className="mb-3 text-xs text-muted">{g.sub}</p>
            <ul className="space-y-2">
              {g.items.map((it) => (
                <li key={it} className="flex items-start gap-2 text-sm text-ink">
                  <span className="prep-box mt-0.5 inline-block h-4 w-4 shrink-0 rounded-sm ring-1 ring-line/40" aria-hidden />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="prep-card mt-4 rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
        <h3 className="font-semibold text-ink">Cadence</h3>
        <ul className="mt-2 space-y-1 text-sm text-ink">
          <li>DEXA every 12 weeks during a defined block (cut or surplus, chosen before it starts); every 6 months in maintenance; never under 6 weeks.</li>
          <li>Bone density is read on the 12-month scan.</li>
          <li>RMR: one duplicate retest within 1–2 weeks of the baseline (two consecutive mornings, same device), then 6-monthly or per block.</li>
        </ul>
      </section>

      <p className="mt-6 text-xs text-muted">{BODY_COPY.disclaimer}</p>
    </main>
  );
}
