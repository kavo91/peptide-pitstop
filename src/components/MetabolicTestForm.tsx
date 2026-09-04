"use client";

/**
 * RMR (indirect calorimetry) entry. Four numbers the clinic prints, the method
 * (VO2-only devices assume an RQ), the subject values as fed to the clinic
 * equation, and the pre-test conditions. When a DEXA scan exists within ±1 day
 * of the ENTERED test date the test links to it and inherits sex/age/height/
 * weight from it (looked up again whenever the date changes; fields stay
 * editable).
 *
 * The reported predicted kcal and activity factor are stored verbatim for
 * display; the app recomputes every equation at read time and never derives a
 * target from them.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { createMetabolicTest, findScanNear, type CreateMetabolicTestInput } from "@/app/actions/bodycomp";
import { PrepChecklist, RMR_PREP_ITEMS, type PrepValue } from "@/components/PrepChecklist";

export interface LinkedScan {
  id: string;
  localDay: string;
  sex: "male" | "female";
  ageYears: string;
  heightCm: string;
  clinicWeightKg: string;
}

type Method = CreateMetabolicTestInput["method"];
const VO2_ONLY_KCAL_PER_L = "4.81";
/** datetime-local fires per segment edit; wait for the user to settle before asking the server. */
const LOOKUP_DEBOUNCE_MS = 250;

function nowLocalInput(): string {
  const n = new Date();
  const off = n.getTimezoneOffset();
  return new Date(n.getTime() - off * 60000).toISOString().slice(0, 16);
}

function deviceTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function MetabolicTestForm({ linkedScan }: { linkedScan: LinkedScan | null }) {
  const router = useRouter();
  const inputCls = "rounded-control border border-line/15 bg-bg px-3 py-2 text-sm";
  const numCls = `mt-1 w-full tabular-nums ${inputCls}`;

  const [testedAtLocal, setTestedAtLocal] = useState(nowLocalInput());
  // The scan nearest the entered date (±1 day). Starts as the server's pick for "now".
  const [linked, setLinked] = useState<LinkedScan | null>(linkedScan);
  const linkedIdRef = useRef<string | null>(linkedScan?.id ?? null);
  const lookupSeq = useRef(0);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [method, setMethod] = useState<Method>("ic_vo2_only");
  const [f, setF] = useState<Record<string, string>>({
    deviceLabel: "", facility: "",
    measuredRmrKcal: "", kcalPerLitreO2: VO2_ONLY_KCAL_PER_L, vo2MlMin: "", vco2MlMin: "", rq: "", durationMin: "", steadyStateCvPct: "",
    ageYears: linkedScan?.ageYears ?? "", heightCm: linkedScan?.heightCm ?? "", weightKg: linkedScan?.clinicWeightKg ?? "",
    reportedPredictedKcal: "", reportedPredictionEquation: "", reportedActivityFactor: "", reportedActivityLabel: "",
    roomTempC: "", notes: "",
  });
  const [sex, setSex] = useState<"male" | "female">(linkedScan?.sex ?? "male");
  const [prep, setPrep] = useState<PrepValue>({});
  const [prepNumbers, setPrepNumbers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));
  const opt = (v: string): string | undefined => (v.trim() ? v.trim() : undefined);

  /** Re-link on every date change: the nearest scan within ±1 day of the ENTERED date wins. */
  function onDateChange(next: string) {
    setTestedAtLocal(next);
    const at = new Date(next);
    if (Number.isNaN(at.getTime())) return;
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const seq = ++lookupSeq.current;
    lookupTimer.current = setTimeout(async () => {
      const found = await findScanNear(at.toISOString());
      if (seq !== lookupSeq.current) return; // a later edit superseded this lookup
      if (!found) {
        linkedIdRef.current = null;
        setLinked(null); // fields keep whatever is typed; only the link is dropped
        return;
      }
      const changed = linkedIdRef.current !== found.id;
      linkedIdRef.current = found.id;
      setLinked(found);
      if (changed) {
        // A different scan is now nearest: inherit its subject block. Every field stays editable.
        setSex(found.sex);
        setF((cur) => ({ ...cur, ageYears: found.ageYears, heightCm: found.heightCm, weightKg: found.clinicWeightKg }));
      }
    }, LOOKUP_DEBOUNCE_MS);
  }

  function onMethodChange(next: Method) {
    setMethod(next);
    // VO2-only devices assume an RQ; 4.81 kcal/L is the usual default. Fill it only if the field is empty.
    if (next === "ic_vo2_only") setF((cur) => (cur.kcalPerLitreO2.trim() ? cur : { ...cur, kcalPerLitreO2: VO2_ONLY_KCAL_PER_L }));
  }

  async function onSubmit() {
    setBusy(true);
    setError(null);
    const at = new Date(testedAtLocal);
    if (Number.isNaN(at.getTime())) {
      setBusy(false);
      setError("Enter the test date and time.");
      return;
    }
    const input: CreateMetabolicTestInput = {
      testedAt: at.toISOString(),
      tz: deviceTz(),
      method,
      deviceLabel: opt(f.deviceLabel), facility: opt(f.facility),
      measuredRmrKcal: f.measuredRmrKcal.trim(),
      kcalPerLitreO2: opt(f.kcalPerLitreO2), vo2MlMin: opt(f.vo2MlMin), vco2MlMin: opt(f.vco2MlMin), rq: opt(f.rq),
      durationMin: opt(f.durationMin), steadyStateCvPct: opt(f.steadyStateCvPct),
      sex, ageYears: f.ageYears.trim(), heightCm: f.heightCm.trim(), weightKg: f.weightKg.trim(),
      reportedPredictedKcal: opt(f.reportedPredictedKcal), reportedPredictionEquation: opt(f.reportedPredictionEquation),
      reportedActivityFactor: opt(f.reportedActivityFactor), reportedActivityLabel: opt(f.reportedActivityLabel),
      prep: {
        fasted: prep.fasted ?? null,
        fastingHours: prep.fasted === true ? opt(prepNumbers.fastingHours ?? "") : undefined,
        noCaffeine: prep.noCaffeine ?? null,
        noTrainingPriorDay: prep.noTrainingPriorDay ?? null,
        activeTravel: prep.activeTravel ?? null,
        rested: prep.rested ?? null,
        restMinBeforeTest: prep.rested === true ? opt(prepNumbers.restMinBeforeTest ?? "") : undefined,
        illnessFree14d: prep.illnessFree14d ?? null,
        awakeQuiet: prep.awakeQuiet ?? null,
      },
      roomTempC: opt(f.roomTempC),
      bodyCompScanId: linked?.id,
      notes: opt(f.notes),
    };
    const res = await createMetabolicTest(input);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not save the metabolic test.");
      return;
    }
    setDone(true);
    router.push("/body");
    router.refresh();
  }

  const field = (k: string, label: string, opts: { required?: boolean; placeholder?: string; text?: boolean } = {}) => (
    <label htmlFor={`mt-${k}`} className="block text-xs text-muted">
      {label}{opts.required && <span className="text-danger"> *</span>}
      <input
        id={`mt-${k}`}
        inputMode={opts.text ? "text" : "decimal"}
        value={f[k]}
        onChange={set(k)}
        placeholder={opts.placeholder}
        className={opts.text ? `mt-1 w-full ${inputCls}` : numCls}
      />
    </label>
  );

  const section = (title: string, sub: string | null, body: React.ReactNode) => (
    <section className="space-y-2">
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        {sub && <p className="text-xs text-muted">{sub}</p>}
      </div>
      {body}
    </section>
  );

  return (
    <div className="space-y-5 rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
      {section("Test", null, (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label htmlFor="mt-testedAt" className="block text-xs text-muted sm:col-span-2">
            Test date and time<span className="text-danger"> *</span>
            <input id="mt-testedAt" type="datetime-local" value={testedAtLocal} onChange={(e) => onDateChange(e.target.value)} className={`mt-1 w-full ${inputCls}`} />
            <span className="mt-1 block text-[11px] text-muted" aria-live="polite">
              {linked ? `Links to the scan on ${linked.localDay} (within ±1 day of the entered date).` : "No scan within ±1 day of the entered date — the test is saved on its own."}
            </span>
          </label>
          <label htmlFor="mt-method" className="block text-xs text-muted">
            Method<span className="text-danger"> *</span>
            <select id="mt-method" value={method} onChange={(e) => onMethodChange(e.target.value as Method)} className={`mt-1 w-full ${inputCls}`}>
              <option value="ic_vo2_only">Indirect calorimetry — VO2 only</option>
              <option value="ic_vo2_vco2">Indirect calorimetry — VO2 + VCO2</option>
              <option value="other">Other</option>
            </select>
            <span className="mt-1 block text-[11px] text-muted">VO2-only devices assume an RQ; 4.81 kcal/L ≈ RQ 0.79.</span>
          </label>
          {field("kcalPerLitreO2", "kcal per litre O2", { placeholder: VO2_ONLY_KCAL_PER_L })}
          {field("deviceLabel", "Device", { text: true, placeholder: "as labelled by the clinic" })}
          {field("facility", "Facility", { text: true })}
        </div>
      ))}

      {section("Measured", "The number the clinic printed, plus anything else on the sheet.", (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {field("measuredRmrKcal", "Measured RMR (kcal/day)", { required: true })}
          {field("vo2MlMin", "VO2 (mL/min)")}
          {field("vco2MlMin", "VCO2 (mL/min)")}
          {field("rq", "RQ")}
          {field("durationMin", "Duration (min)")}
          {field("steadyStateCvPct", "Steady-state CV %")}
        </div>
      ))}

      {section(
        "Subject",
        linked ? `Inherited from the scan on ${linked.localDay} — the values the clinic fed its equation; edit anything that differs.` : "As fed to the clinic's prediction equation.",
        (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label htmlFor="mt-sex" className="block text-xs text-muted">
              Sex<span className="text-danger"> *</span>
              <select id="mt-sex" value={sex} onChange={(e) => setSex(e.target.value as "male" | "female")} className={`mt-1 w-full ${inputCls}`}>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
            {field("ageYears", "Age (years)", { required: true })}
            {field("heightCm", "Height (cm)", { required: true })}
            {field("weightKg", "Weight (kg)", { required: true })}
          </div>
        ),
      )}

      {section("Clinic-printed prediction", "Stored as printed. The app recomputes every equation and derives no target.", (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {field("reportedPredictedKcal", "Predicted RMR (kcal)")}
          {field("reportedPredictionEquation", "Equation label", { text: true, placeholder: "e.g. Mifflin-St Jeor" })}
          {field("reportedActivityFactor", "Activity factor")}
          {field("reportedActivityLabel", "Activity label", { text: true, placeholder: "e.g. Moderate" })}
        </div>
      ))}

      {section("Conditions", "Unknown is a valid answer; the dashboard marks unrecorded conditions.", (
        <PrepChecklist value={prep} onChange={setPrep} items={RMR_PREP_ITEMS} numbers={prepNumbers} onNumbersChange={setPrepNumbers} idPrefix="mt-prep" />
      ))}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field("roomTempC", "Room temperature (°C)")}
        <label htmlFor="mt-notes" className="block text-xs text-muted">
          Notes
          <input id="mt-notes" value={f.notes} onChange={set("notes")} placeholder="Optional, encrypted" className={`mt-1 w-full ${inputCls}`} />
        </label>
      </div>

      {linked && <input type="hidden" name="bodyCompScanId" value={linked.id} />}

      {error && <p className="text-sm text-danger">{error}</p>}
      {done && <p className="rounded-control bg-ok/10 px-3 py-2 text-sm font-medium text-ok">Metabolic test saved ✓</p>}

      <button
        type="button"
        onClick={onSubmit}
        disabled={busy}
        className="w-full rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40"
      >
        <Save className="mr-1.5 inline h-4 w-4 align-[-0.125em]" aria-hidden />{busy ? "Saving…" : "Save RMR test"}
      </button>
    </div>
  );
}
