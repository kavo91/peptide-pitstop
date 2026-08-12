"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  createPrescriptionWizard,
  type PrescriptionWizardInput,
  type PrescriptionWizardResult,
} from "@/app/actions/prescription-wizard";
import { type WeekdayCode } from "@/lib/schedule/schedule";
import {
  parseSchedule,
  scheduleSummary,
  type DayPattern,
  type Schedule,
  type ScheduleEntry,
} from "@/lib/schedule/entries";
import {
  buildPreparationPreview,
  createNeutralPreparationDraft,
  createNeutralProtocolDraft,
  createNeutralStackWizardComponent,
  isPerWeekScheduleBlocked,
  normaliseStackWizardComponent,
} from "@/lib/prescription-wizard";

const field =
  "w-full rounded-control border border-line/15 bg-bg px-3 py-2 text-sm text-ink";
const label = "block text-sm text-muted";
const chip =
  "rounded-full border border-line/15 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em]";
const DAYS: WeekdayCode[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

type PeptideOption = {
  id: string;
  name: string;
  aliases: string;
  category: string;
  substanceClass: string;
  defaultStrengthMg: string;
  halfLifeHours: string;
  minIntervalHours: string;
  missedDosePolicy: string;
  route: string;
  storageNotes: string;
};

type LibraryOption = {
  name: string;
  aliases: string;
  category: string;
  substanceClass: string;
  defaultStrengthMg: string;
  halfLifeHours: string;
  route: string;
  storageNotes: string;
};

type StackOption = { id: string; name: string; notes: string | null };
type SyringeOption = { id: string; name: string };

const COMPOSITE_LIBRARY_CATEGORIES = new Set(["blend", "blends", "stack", "stacks"]);

function isCompositeLibraryOption(option: LibraryOption) {
  return COMPOSITE_LIBRARY_CATEGORIES.has(option.category.trim().toLowerCase());
}

function displayMgPerMlFromStoredMcg(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return "";
  const mgPerMl = numeric / 1000;
  return Number.isInteger(mgPerMl) ? String(mgPerMl) : mgPerMl.toString();
}

function storeMcgPerMlFromMgInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return trimmed;
  const mcgPerMl = numeric * 1000;
  return Number.isInteger(mcgPerMl) ? String(mcgPerMl) : mcgPerMl.toString();
}

type ComponentState = {
  key: string;
  peptideName: string;
  concentrationMcgPerMl: string;
  vialSizeMl: string;
  qty: string;
  doseMl: string;
  scheduleRule: string;
  startDate: string;
  endDate: string;
};

function emptyComponent(): ComponentState {
  return {
    key: Math.random().toString(36).slice(2),
    ...createNeutralStackWizardComponent(),
  };
}

function ScheduleEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const parsed = parseSchedule(value);
  const [entries, setEntries] = useState<Schedule>(parsed);

  useEffect(() => {
    setEntries(parseSchedule(value));
  }, [value]);

  function commit(next: Schedule) {
    setEntries(next);
    onChange(JSON.stringify(next));
  }

  function updateEntry(index: number, entry: ScheduleEntry) {
    commit(entries.map((current, currentIndex) => (currentIndex === index ? entry : current)));
  }

  function addEntry() {
    // Start invalid and require the user to choose the cadence from the label
    // or prescriber directions. The wizard must not author a regimen.
    commit([...entries, { dayPattern: { kind: "weekly", byDays: [] }, times: [] }]);
  }

  function removeEntry(index: number) {
    commit(entries.filter((_, currentIndex) => currentIndex !== index));
  }

  const valid =
    entries.length > 0 &&
    entries.every((entry) => {
      const pattern = entry.dayPattern;
      const patternValid =
        pattern.kind === "weekly"
          ? pattern.byDays.length > 0
          : pattern.kind === "interval"
            ? pattern.everyDays > 0
            : pattern.kind === "cycle"
              ? pattern.onDays > 0 && pattern.offDays > 0
              : true;
      return patternValid && entry.times.every((time) => /^\d{2}:\d{2}$/.test(time));
    });

  return (
    <div className="space-y-2 rounded-control bg-bg p-3 ring-1 ring-line/10">
      {entries.map((entry, index) => (
        <div key={index} className="space-y-2 rounded-control bg-surface p-3 ring-1 ring-line/10">
          <div className="flex items-center gap-2">
            <select
              className={field}
              name={`schedule-entry-${index}-pattern`}
              value={entry.dayPattern.kind}
              onChange={(event) => {
                const kind = event.target.value as DayPattern["kind"];
                const nextPattern: DayPattern =
                  kind === "daily"
                    ? { kind: "daily" }
                    : kind === "weekly"
                      ? { kind: "weekly", byDays: [] }
                      : kind === "interval"
                        ? { kind: "interval", everyDays: 0 }
                        : { kind: "cycle", onDays: 0, offDays: 0 };
                updateEntry(index, { ...entry, dayPattern: nextPattern });
              }}
            >
              <option value="daily">Every day</option>
              <option value="weekly">Specific weekdays</option>
              <option value="interval">Every N days</option>
              <option value="cycle">Cycle (on/off)</option>
            </select>
            <button
              type="button"
              onClick={() => removeEntry(index)}
              className="rounded-control bg-bg px-3 py-2 text-danger ring-1 ring-line/15"
              aria-label="Remove schedule entry"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {entry.dayPattern.kind === "weekly" && (
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((day) => {
                const byDays = (entry.dayPattern as { kind: "weekly"; byDays: WeekdayCode[] }).byDays;
                const selected = byDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() =>
                      updateEntry(index, {
                        ...entry,
                        dayPattern: {
                          kind: "weekly",
                          byDays: selected
                            ? byDays.filter((current) => current !== day)
                            : [...byDays, day],
                        },
                      })
                    }
                    className={`rounded-control px-3 py-1.5 text-xs font-medium ${
                      selected ? "bg-accent text-onAccent" : "bg-bg ring-1 ring-line/15"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          )}

          {entry.dayPattern.kind === "interval" && (
            <label className={label}>
              Every
              <input
                className={field + " mt-1"}
                name={`schedule-entry-${index}-every-days`}
                autoComplete="off"
                inputMode="numeric"
                value={(entry.dayPattern as { everyDays: number }).everyDays || ""}
                onChange={(event) =>
                  updateEntry(index, {
                    ...entry,
                    dayPattern: {
                      kind: "interval",
                      everyDays: event.target.value
                        ? Math.max(1, Number.parseInt(event.target.value, 10))
                        : 0,
                    },
                  })
                }
              />
            </label>
          )}

          {entry.dayPattern.kind === "cycle" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={label}>
                Days on
                <input
                  className={field + " mt-1"}
                  name={`schedule-entry-${index}-days-on`}
                  autoComplete="off"
                  inputMode="numeric"
                  min={1}
                  value={(entry.dayPattern as { onDays: number; offDays: number }).onDays || ""}
                  onChange={(event) =>
                    updateEntry(index, {
                      ...entry,
                      dayPattern: {
                        ...(entry.dayPattern as { kind: "cycle"; onDays: number; offDays: number }),
                        onDays: event.target.value
                          ? Math.max(1, Number.parseInt(event.target.value, 10))
                          : 0,
                      },
                    })
                  }
                />
              </label>
              <label className={label}>
                Days off
                <input
                  className={field + " mt-1"}
                  name={`schedule-entry-${index}-days-off`}
                  autoComplete="off"
                  inputMode="numeric"
                  min={1}
                  value={(entry.dayPattern as { onDays: number; offDays: number }).offDays || ""}
                  onChange={(event) =>
                    updateEntry(index, {
                      ...entry,
                      dayPattern: {
                        ...(entry.dayPattern as { kind: "cycle"; onDays: number; offDays: number }),
                        offDays: event.target.value
                          ? Math.max(1, Number.parseInt(event.target.value, 10))
                          : 0,
                      },
                    })
                  }
                />
              </label>
            </div>
          )}

          <div>
              <p className="text-xs text-muted">Times (blank = any time)</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {entry.times.map((time, timeIndex) => (
                  <span key={timeIndex} className="flex items-center gap-1">
                    <input
                      type="time"
                      className="rounded-control border border-line/15 bg-bg px-2 py-1 text-sm"
                      name={`schedule-entry-${index}-time-${timeIndex}`}
                      autoComplete="off"
                      value={time}
                      onChange={(event) =>
                        updateEntry(index, {
                          ...entry,
                          times: entry.times.map((current, currentIndex) =>
                            currentIndex === timeIndex ? event.target.value : current,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateEntry(index, {
                          ...entry,
                          times: entry.times.filter((_, currentIndex) => currentIndex !== timeIndex),
                        })
                      }
                      className="text-danger"
                      aria-label="Remove time"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => updateEntry(index, { ...entry, times: [...entry.times, ""] })}
                  className="rounded-control bg-bg px-2 py-1 text-xs ring-1 ring-line/15"
                >
                  + time
                </button>
              </div>
            </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addEntry}
        className="w-full rounded-control bg-surface px-3 py-2 text-sm font-medium text-accentStrong ring-1 ring-line/15"
      >
        + Add schedule entry
      </button>
      <p className="text-xs text-muted">
        Preview: <span className="text-ink">{scheduleSummary(entries)}</span>
      </p>
      {!valid && (
        <p className="text-xs text-warn">
          Transcribe a complete schedule: choose days/cadence and enter any listed times.
        </p>
      )}
    </div>
  );
}

export function PrescriptionWizardForm({
  peptides,
  library,
  stacks,
  syringes,
}: {
  peptides: PeptideOption[];
  library: LibraryOption[];
  stacks: StackOption[];
  syringes: SyringeOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const [target, setTarget] = useState<"peptide" | "stack">("peptide");
  const [peptideMode, setPeptideMode] = useState<"existing" | "library" | "custom">(
    peptides.length > 0 ? "existing" : "library",
  );
  const [peptide, setPeptide] = useState({
    id: "",
    name: "",
    aliases: "",
    category: "",
    substanceClass: "mass" as "mass" | "IU",
    defaultStrengthMg: "",
    halfLifeHours: "",
    minIntervalHours: "",
    missedDosePolicy: "prompt" as "skip" | "take_now" | "prompt",
    route: "injection" as "injection" | "oral",
    storageNotes: "",
  });
  const [stackMode, setStackMode] = useState<"existing" | "new">(
    stacks.length > 0 ? "existing" : "new",
  );
  const [stackId, setStackId] = useState("");
  const [stackName, setStackName] = useState("");
  const [stackNotes, setStackNotes] = useState("");
  const [components, setComponents] = useState<ComponentState[]>([emptyComponent()]);
  const [prescription, setPrescription] = useState({
    source: "",
    pharmacy: "",
    prescriber: "",
    cost: "",
    currency: "AUD",
    quantity: "",
    refillsAuthorized: "",
    refillsRemaining: "",
    dateWritten: "",
    nextRefill: "",
    expiration: "",
    leadTimeDays: "",
    doseInstructions: "",
    status: "active",
  });
  const [vial, setVial] = useState({
    labelStrengthMg: "",
    lot: "",
    expiry: "",
    storageLocation: "",
    status: "sealed",
  });
  const [preparation, setPreparation] = useState(createNeutralPreparationDraft);
  const [protocol, setProtocol] = useState(createNeutralProtocolDraft);
  const [directionsConfirmed, setDirectionsConfirmed] = useState(false);
  const [result, setResult] = useState<PrescriptionWizardResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedExistingPeptide = peptides.find((option) => option.id === peptide.id) ?? null;
  const singleRoute =
    peptideMode === "existing"
      ? (selectedExistingPeptide?.route ?? "injection")
      : (peptide.route ?? "injection");
  const singleInjection = target === "peptide" && singleRoute !== "oral";
  const preparationPreview = buildPreparationPreview({
    enabled: singleInjection && preparation.enabled,
    prepType: preparation.prepType,
    totalMg: preparation.totalMg,
    bacWaterMl: preparation.bacWaterMl,
    concentrationMcgPerMl: preparation.concentrationMcgPerMl,
    vialVolumeMl: preparation.vialVolumeMl,
  });
  const perWeekBlocked = isPerWeekScheduleBlocked(protocol.doseBasis, protocol.scheduleRule);
  const singlePeptideLibrary = library.filter((option) => !isCompositeLibraryOption(option));
  const allPeptideNames = Array.from(
    new Set([...peptides.map((option) => option.name), ...library.map((option) => option.name)]),
  ).sort((left, right) => left.localeCompare(right));

  useEffect(() => {
    if (!singleInjection) {
      setPreparation((current) => ({ ...current, enabled: false }));
      setVial((current) => ({ ...current, labelStrengthMg: "" }));
    }
  }, [singleInjection]);

  useEffect(() => {
    setError(null);
    setResult(null);
  }, [target, peptideMode, stackMode, singleRoute]);

  function patchPeptide(next: Partial<typeof peptide>) {
    setPeptide((current) => ({ ...current, ...next }));
  }

  function applyLibraryChoice(name: string) {
    const choice = library.find((entry) => entry.name === name);
    patchPeptide({
      name,
      aliases: choice?.aliases ?? "",
      category: choice?.category ?? "",
      substanceClass: (choice?.substanceClass ?? "mass") as "mass" | "IU",
      defaultStrengthMg: choice?.defaultStrengthMg ?? "",
      halfLifeHours: choice?.halfLifeHours ?? "",
      route: (choice?.route ?? "injection") as "injection" | "oral",
      storageNotes: choice?.storageNotes ?? "",
    });
  }

  function updateComponent(key: string, patch: Partial<ComponentState>) {
    setComponents((current) =>
      current.map((component) => (component.key === key ? { ...component, ...patch } : component)),
    );
  }

  function buildPayload(): PrescriptionWizardInput {
    return {
      target,
      directionsConfirmed,
      peptide:
        target === "peptide"
          ? {
              mode: peptideMode,
              id: peptide.id,
              name: peptide.name,
              aliases: peptide.aliases,
              category: peptide.category,
              substanceClass: peptide.substanceClass,
              defaultStrengthMg: peptide.defaultStrengthMg,
              halfLifeHours: peptide.halfLifeHours,
              minIntervalHours: peptide.minIntervalHours,
              missedDosePolicy: peptide.missedDosePolicy,
              route: peptide.route,
              storageNotes: peptide.storageNotes,
            }
          : undefined,
      stack:
        target === "stack"
          ? {
              mode: stackMode,
              id: stackId,
              name: stackName,
              notes: stackNotes,
              components: components.map((component) => {
                const normalised = normaliseStackWizardComponent(component);
                return {
                  peptideName: normalised.peptideName,
                  concentrationMcgPerMl: normalised.concentrationMcgPerMl,
                  vialSizeMl: normalised.vialSizeMl,
                  qty: normalised.qty,
                  doseMl: normalised.doseMl,
                  scheduleRule: normalised.scheduleRule,
                  startDate: normalised.startDate,
                  endDate: normalised.endDate || undefined,
                };
              }),
            }
          : undefined,
      prescription,
      vial: singleInjection ? vial : undefined,
      preparation:
        target === "peptide"
          ? {
              enabled: singleInjection && preparation.enabled,
              prepType: preparation.prepType,
              totalMg: preparation.totalMg,
              bacWaterMl: preparation.bacWaterMl,
              concentrationMcgPerMl: preparation.concentrationMcgPerMl,
              vialVolumeMl: preparation.vialVolumeMl,
              beyondUseDateISO: preparation.beyondUseDateISO,
            }
          : undefined,
      protocol:
        target === "peptide"
          ? {
              enabled: protocol.enabled,
              name: protocol.name,
              scheduleType: protocol.scheduleType,
              scheduleRule: protocol.scheduleRule,
              rebaseMode: protocol.rebaseMode,
              adherenceWindowMin: protocol.adherenceWindowMin,
              defaultSyringeId: singleInjection ? protocol.defaultSyringeId : "",
              targetDose: protocol.targetDose,
              doseInputUnit: protocol.doseInputUnit,
              doseBasis: protocol.doseBasis,
              startDate: protocol.startDate,
              endDate: protocol.endDate,
              status: protocol.status,
            }
          : undefined,
    };
  }

  function submit() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const next = await createPrescriptionWizard(buildPayload());
      if (!next.ok) {
        setError(next.error);
        return;
      }
      setResult(next);
    });
  }

  const reviewName =
    target === "peptide"
      ? peptideMode === "existing"
        ? selectedExistingPeptide?.name || "Existing peptide"
        : peptide.name || "New peptide"
      : stackMode === "existing"
        ? stacks.find((option) => option.id === stackId)?.name || "Existing stack"
        : stackName || "New stack";
  const directionsRequired = target === "stack" || protocol.enabled;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <section className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
          <p className="mb-4 text-sm text-muted">
            Transcribe existing directions exactly as written. Peptide Pitstop does not select a
            dose, schedule, preparation volume, or beyond-use date.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className={chip}>Target</span>
            <span className={chip}>Script</span>
            {target === "peptide" && singleInjection && <span className={chip}>Inventory</span>}
            {target === "peptide" && singleInjection && <span className={chip}>Prep</span>}
            <span className={chip}>Protocol</span>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setTarget("peptide")}
              className={`rounded-control px-4 py-2 text-sm font-medium ${
                target === "peptide" ? "bg-accent text-onAccent" : "bg-bg ring-1 ring-line/15"
              }`}
            >
              Single peptide
            </button>
            <button
              type="button"
              onClick={() => setTarget("stack")}
              className={`rounded-control px-4 py-2 text-sm font-medium ${
                target === "stack" ? "bg-accent text-onAccent" : "bg-bg ring-1 ring-line/15"
              }`}
            >
              Stack
            </button>
          </div>
        </section>

        {target === "peptide" ? (
          <section className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
            <h2 className="text-base font-semibold">Peptide</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["existing", "library", "custom"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPeptideMode(mode)}
                  className={`rounded-control px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] ${
                    peptideMode === mode
                      ? "bg-accent text-onAccent"
                      : "bg-bg text-muted ring-1 ring-line/15"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            {peptideMode === "existing" ? (
              <label className={label + " mt-4"}>
                Existing peptide
                <select
                  className={field + " mt-1"}
                  name="peptide-existing-id"
                  value={peptide.id}
                  onChange={(event) => patchPeptide({ id: event.target.value })}
                >
                  <option value="">Choose a peptide</option>
                  {peptides.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="mt-4 space-y-3">
                <label className={label}>
                  {peptideMode === "library" ? "Library peptide" : "Peptide name"}
                  {peptideMode === "library" ? (
                    <select
                      className={field + " mt-1"}
                      name="peptide-library-name"
                      value={peptide.name}
                      onChange={(event) => applyLibraryChoice(event.target.value)}
                    >
                      <option value="">Choose a library entry</option>
                      {singlePeptideLibrary.map((option) => (
                        <option key={option.name} value={option.name}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={field + " mt-1"}
                      name="peptide-name"
                      autoComplete="off"
                      value={peptide.name}
                      onChange={(event) => patchPeptide({ name: event.target.value })}
                      placeholder="e.g. BPC-157"
                    />
                  )}
                </label>
                <input
                  className={field}
                  name="peptide-aliases"
                  autoComplete="off"
                  value={peptide.aliases}
                  onChange={(event) => patchPeptide({ aliases: event.target.value })}
                  placeholder="Aliases (comma-separated)"
                />
                <div className="grid gap-3 md:grid-cols-3">
                  <input
                    className={field}
                    name="peptide-category"
                    autoComplete="off"
                    value={peptide.category}
                    onChange={(event) => patchPeptide({ category: event.target.value })}
                    placeholder="Category"
                  />
                  <select
                    className={field}
                    name="peptide-route"
                    value={peptide.route}
                    onChange={(event) =>
                      patchPeptide({ route: event.target.value as "injection" | "oral" })
                    }
                  >
                    <option value="injection">Injection</option>
                    <option value="oral">Oral</option>
                  </select>
                  <select
                    className={field}
                    name="peptide-substance-class"
                    value={peptide.substanceClass}
                    onChange={(event) =>
                      patchPeptide({ substanceClass: event.target.value as "mass" | "IU" })
                    }
                  >
                    <option value="mass">mass</option>
                    <option value="IU">IU</option>
                  </select>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <input
                    className={field}
                    name="peptide-default-strength-mg"
                    autoComplete="off"
                    value={peptide.defaultStrengthMg}
                    onChange={(event) => patchPeptide({ defaultStrengthMg: event.target.value })}
                    placeholder="Default strength mg"
                  />
                  <input
                    className={field}
                    name="peptide-half-life-hours"
                    autoComplete="off"
                    value={peptide.halfLifeHours}
                    onChange={(event) => patchPeptide({ halfLifeHours: event.target.value })}
                    placeholder="Half-life h"
                  />
                  <input
                    className={field}
                    name="peptide-min-interval-hours"
                    autoComplete="off"
                    value={peptide.minIntervalHours}
                    onChange={(event) => patchPeptide({ minIntervalHours: event.target.value })}
                    placeholder="Min interval h"
                  />
                </div>
                <select
                  className={field}
                  name="peptide-missed-dose-policy"
                  value={peptide.missedDosePolicy}
                  onChange={(event) =>
                    patchPeptide({
                      missedDosePolicy: event.target.value as "skip" | "take_now" | "prompt",
                    })
                  }
                >
                  <option value="prompt">prompt</option>
                  <option value="skip">skip</option>
                  <option value="take_now">take now</option>
                </select>
                <input
                  className={field}
                  name="peptide-storage-notes"
                  autoComplete="off"
                  value={peptide.storageNotes}
                  onChange={(event) => patchPeptide({ storageNotes: event.target.value })}
                  placeholder="Storage notes"
                />
              </div>
            )}
          </section>
        ) : (
          <section className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
            <h2 className="text-base font-semibold">Stack</h2>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setStackMode("existing")}
                className={`rounded-control px-4 py-2 text-sm font-medium ${
                  stackMode === "existing" ? "bg-accent text-onAccent" : "bg-bg ring-1 ring-line/15"
                }`}
              >
                Existing
              </button>
              <button
                type="button"
                onClick={() => setStackMode("new")}
                className={`rounded-control px-4 py-2 text-sm font-medium ${
                  stackMode === "new" ? "bg-accent text-onAccent" : "bg-bg ring-1 ring-line/15"
                }`}
              >
                New stack
              </button>
            </div>

            {stackMode === "existing" && stacks.length > 0 ? (
              <label className={label + " mt-4"}>
                Existing stack
                <select
                  className={field + " mt-1"}
                  name="stack-id"
                  value={stackId}
                  onChange={(event) => setStackId(event.target.value)}
                >
                  <option value="">Choose a stack</option>
                  {stacks.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="mt-4 grid gap-3">
                <input
                  className={field}
                  name="stack-name"
                  autoComplete="off"
                  value={stackName}
                  onChange={(event) => setStackName(event.target.value)}
                  placeholder="Stack name"
                />
                <input
                  className={field}
                  name="stack-notes"
                  autoComplete="off"
                  value={stackNotes}
                  onChange={(event) => setStackNotes(event.target.value)}
                  placeholder="Notes (optional)"
                />
              </div>
            )}

            <div className="mt-4 space-y-3">
              {components.map((component, index) => (
                <div key={component.key} className="rounded-control bg-bg p-3 ring-1 ring-line/10">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Component {index + 1}</p>
                    {components.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setComponents((current) =>
                            current.filter((entry) => entry.key !== component.key),
                          )
                        }
                        className="text-xs font-medium text-danger"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="mt-3 grid gap-3">
                    <div>
                      <input
                        className={field}
                        list="wizard-peptide-names"
                        name={`component-${component.key}-peptide-name`}
                        autoComplete="off"
                        value={component.peptideName}
                        onChange={(event) =>
                          updateComponent(component.key, { peptideName: event.target.value })
                        }
                        placeholder="Peptide"
                      />
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <input
                        className={field}
                        name={`component-${component.key}-concentration`}
                        autoComplete="off"
                        value={displayMgPerMlFromStoredMcg(component.concentrationMcgPerMl)}
                        onChange={(event) =>
                          updateComponent(component.key, {
                            concentrationMcgPerMl: storeMcgPerMlFromMgInput(event.target.value),
                          })
                        }
                        placeholder="mg/mL"
                      />
                      <input
                        className={field}
                        name={`component-${component.key}-vial-size-ml`}
                        autoComplete="off"
                        value={component.vialSizeMl}
                        onChange={(event) =>
                          updateComponent(component.key, { vialSizeMl: event.target.value })
                        }
                        placeholder="Vial mL"
                      />
                      <input
                        className={field}
                        name={`component-${component.key}-qty`}
                        autoComplete="off"
                        value={component.qty}
                        onChange={(event) =>
                          updateComponent(component.key, { qty: event.target.value })
                        }
                        placeholder="Qty"
                      />
                      <input
                        className={field}
                        name={`component-${component.key}-dose-ml`}
                        autoComplete="off"
                        value={component.doseMl}
                        onChange={(event) =>
                          updateComponent(component.key, { doseMl: event.target.value })
                        }
                        placeholder="Dose mL"
                      />
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={label}>
                        Start date
                        <input
                          type="date"
                          className={field + " mt-1"}
                          name={`component-${component.key}-start-date`}
                          autoComplete="off"
                          value={component.startDate}
                          onInput={(event) => {
                            const value = event.currentTarget.value;
                            updateComponent(component.key, { startDate: value });
                          }}
                          onChange={(event) =>
                            updateComponent(component.key, { startDate: event.target.value })
                          }
                        />
                      </label>
                      <label className={label}>
                        End date
                        <input
                          type="date"
                          className={field + " mt-1"}
                          name={`component-${component.key}-end-date`}
                          autoComplete="off"
                          value={component.endDate}
                          onInput={(event) => {
                            const value = event.currentTarget.value;
                            updateComponent(component.key, { endDate: value });
                          }}
                          onChange={(event) =>
                            updateComponent(component.key, { endDate: event.target.value })
                          }
                        />
                      </label>
                    </div>
                    <ScheduleEditor
                      value={component.scheduleRule}
                      onChange={(next) => updateComponent(component.key, { scheduleRule: next })}
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setComponents((current) => [...current, emptyComponent()])}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accentStrong"
            >
              <Plus className="h-4 w-4" aria-hidden /> Add component
            </button>
          </section>
        )}

        <section className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
          <h2 className="text-base font-semibold">Prescription</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <input
              className={field}
              name="prescription-source"
              autoComplete="off"
              value={prescription.source}
              onChange={(event) =>
                setPrescription((current) => ({ ...current, source: event.target.value }))
              }
              placeholder="Pharmacy / source"
            />
            <input
              className={field}
              name="prescription-prescriber"
              autoComplete="off"
              value={prescription.prescriber}
              onChange={(event) =>
                setPrescription((current) => ({ ...current, prescriber: event.target.value }))
              }
              placeholder="Prescriber"
            />
            <input
              className={field}
              name="prescription-pharmacy"
              autoComplete="off"
              value={prescription.pharmacy}
              onChange={(event) =>
                setPrescription((current) => ({ ...current, pharmacy: event.target.value }))
              }
              placeholder="Pharmacy"
            />
            <input
              className={field}
              name="prescription-cost"
              autoComplete="off"
              value={prescription.cost}
              onChange={(event) =>
                setPrescription((current) => ({ ...current, cost: event.target.value }))
              }
              placeholder="Cost"
            />
            <input
              className={field}
              name="prescription-quantity"
              autoComplete="off"
              value={prescription.quantity}
              onChange={(event) =>
                setPrescription((current) => ({ ...current, quantity: event.target.value }))
              }
              placeholder="Quantity"
            />
            <input
              className={field}
              name="prescription-lead-time-days"
              autoComplete="off"
              value={prescription.leadTimeDays}
              onChange={(event) =>
                setPrescription((current) => ({ ...current, leadTimeDays: event.target.value }))
              }
              placeholder="Lead time days"
            />
            <label className={label}>
              Date written
              <input
                type="date"
                className={field + " mt-1"}
                name="prescription-date-written"
                autoComplete="off"
                value={prescription.dateWritten}
                onInput={(event) => {
                  const value = event.currentTarget.value;
                  setPrescription((current) => ({ ...current, dateWritten: value }));
                }}
                onChange={(event) =>
                  setPrescription((current) => ({ ...current, dateWritten: event.target.value }))
                }
              />
            </label>
            <label className={label}>
              Next refill date
              <input
                type="date"
                className={field + " mt-1"}
                name="prescription-next-refill"
                autoComplete="off"
                value={prescription.nextRefill}
                onInput={(event) => {
                  const value = event.currentTarget.value;
                  setPrescription((current) => ({ ...current, nextRefill: value }));
                }}
                onChange={(event) =>
                  setPrescription((current) => ({ ...current, nextRefill: event.target.value }))
                }
              />
            </label>
            <label className={label}>
              Expiration date
              <input
                type="date"
                className={field + " mt-1"}
                name="prescription-expiration"
                autoComplete="off"
                value={prescription.expiration}
                onInput={(event) => {
                  const value = event.currentTarget.value;
                  setPrescription((current) => ({ ...current, expiration: value }));
                }}
                onChange={(event) =>
                  setPrescription((current) => ({ ...current, expiration: event.target.value }))
                }
              />
            </label>
            <select
              className={field}
              name="prescription-status"
              value={prescription.status}
              onChange={(event) =>
                setPrescription((current) => ({ ...current, status: event.target.value }))
              }
            >
              <option value="active">active</option>
              <option value="expired">expired</option>
              <option value="cancelled">cancelled</option>
            </select>
            <input
              className={field}
              name="prescription-refills-authorized"
              autoComplete="off"
              value={prescription.refillsAuthorized}
              onChange={(event) =>
                setPrescription((current) => ({
                  ...current,
                  refillsAuthorized: event.target.value,
                }))
              }
              placeholder="Refills authorized"
            />
            <input
              className={field}
              name="prescription-refills-remaining"
              autoComplete="off"
              value={prescription.refillsRemaining}
              onChange={(event) =>
                setPrescription((current) => ({
                  ...current,
                  refillsRemaining: event.target.value,
                }))
              }
              placeholder="Refills remaining"
            />
          </div>
          <textarea
            className={field + " mt-3 min-h-24"}
            name="prescription-dose-instructions"
            autoComplete="off"
            value={prescription.doseInstructions}
            onChange={(event) =>
              setPrescription((current) => ({ ...current, doseInstructions: event.target.value }))
            }
            placeholder="Dose instructions from the label"
          />
        </section>

        {target === "peptide" && singleInjection && (
          <>
            <section className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
              <h2 className="text-base font-semibold">Vial</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <input
                  className={field}
                  name="vial-label-strength-mg"
                  autoComplete="off"
                  value={vial.labelStrengthMg}
                  onChange={(event) =>
                    setVial((current) => ({ ...current, labelStrengthMg: event.target.value }))
                  }
                  placeholder="Label strength mg"
                />
                <input
                  className={field}
                  name="vial-lot"
                  autoComplete="off"
                  value={vial.lot}
                  onChange={(event) =>
                    setVial((current) => ({ ...current, lot: event.target.value }))
                  }
                  placeholder="Lot"
                />
                <label className={label}>
                  Expiry date
                  <input
                    type="date"
                    className={field + " mt-1"}
                    name="vial-expiry"
                    autoComplete="off"
                    value={vial.expiry}
                    onInput={(event) => {
                      const value = event.currentTarget.value;
                      setVial((current) => ({ ...current, expiry: value }));
                    }}
                    onChange={(event) =>
                      setVial((current) => ({ ...current, expiry: event.target.value }))
                    }
                  />
                </label>
                <input
                  className={field}
                  name="vial-storage-location"
                  autoComplete="off"
                  value={vial.storageLocation}
                  onChange={(event) =>
                    setVial((current) => ({
                      ...current,
                      storageLocation: event.target.value,
                    }))
                  }
                  placeholder="Storage location"
                />
              </div>
            </section>

            <section className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Preparation</h2>
                <label className="inline-flex items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    name="preparation-enabled"
                    checked={preparation.enabled}
                    onChange={(event) =>
                      setPreparation((current) => ({ ...current, enabled: event.target.checked }))
                    }
                  />
                  Create active prep now
                </label>
              </div>
              {preparation.enabled && (
                <div className="mt-3 space-y-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setPreparation((current) => ({ ...current, prepType: "reconstituted" }))
                      }
                      className={`rounded-control px-4 py-2 text-sm font-medium ${
                        preparation.prepType === "reconstituted"
                          ? "bg-accent text-onAccent"
                          : "bg-bg ring-1 ring-line/15"
                      }`}
                    >
                      Reconstituted
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPreparation((current) => ({ ...current, prepType: "premixed" }))
                      }
                      className={`rounded-control px-4 py-2 text-sm font-medium ${
                        preparation.prepType === "premixed"
                          ? "bg-accent text-onAccent"
                          : "bg-bg ring-1 ring-line/15"
                      }`}
                    >
                      Premixed
                    </button>
                  </div>
                  {preparation.prepType === "reconstituted" ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        className={field}
                        name="preparation-total-mg"
                        autoComplete="off"
                        value={preparation.totalMg}
                        onChange={(event) =>
                          setPreparation((current) => ({ ...current, totalMg: event.target.value }))
                        }
                        placeholder="Total mg in vial"
                      />
                      <input
                        className={field}
                        name="preparation-bac-water-ml"
                        autoComplete="off"
                        value={preparation.bacWaterMl}
                        onChange={(event) =>
                          setPreparation((current) => ({
                            ...current,
                            bacWaterMl: event.target.value,
                          }))
                        }
                        placeholder="BAC water mL"
                      />
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        className={field}
                        name="preparation-concentration-mg-per-ml"
                        autoComplete="off"
                        value={displayMgPerMlFromStoredMcg(preparation.concentrationMcgPerMl)}
                        onChange={(event) =>
                          setPreparation((current) => ({
                            ...current,
                            concentrationMcgPerMl: storeMcgPerMlFromMgInput(event.target.value),
                          }))
                        }
                        placeholder="Concentration mg/mL"
                      />
                      <input
                        className={field}
                        name="preparation-vial-volume-ml"
                        autoComplete="off"
                        value={preparation.vialVolumeMl}
                        onChange={(event) =>
                          setPreparation((current) => ({
                            ...current,
                            vialVolumeMl: event.target.value,
                          }))
                        }
                        placeholder="Vial volume mL"
                      />
                    </div>
                  )}
                  <label className={label}>
                    Beyond-use date
                    <input
                      type="date"
                      className={field + " mt-1"}
                      name="preparation-beyond-use-date"
                      autoComplete="off"
                      value={preparation.beyondUseDateISO}
                      onInput={(event) => {
                        const value = event.currentTarget.value;
                        setPreparation((current) => ({
                          ...current,
                          beyondUseDateISO: value,
                        }));
                      }}
                      onChange={(event) =>
                        setPreparation((current) => ({
                          ...current,
                          beyondUseDateISO: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              )}
            </section>
          </>
        )}

        {target === "peptide" && (
          <section className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Protocol</h2>
              <label className="inline-flex items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    name="protocol-enabled"
                    checked={protocol.enabled}
                    onChange={(event) =>
                      setProtocol((current) => ({ ...current, enabled: event.target.checked }))
                  }
                />
                Create protocol now
              </label>
            </div>
            {protocol.enabled && (
              <div className="mt-3 space-y-3">
                <input
                  className={field}
                  name="protocol-name"
                  autoComplete="off"
                  value={protocol.name}
                  onChange={(event) =>
                    setProtocol((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Protocol name"
                />
                <div className="grid gap-3 md:grid-cols-2">
                  <select
                    className={field}
                    name="protocol-schedule-type"
                    value={protocol.scheduleType}
                    onChange={(event) =>
                      setProtocol((current) => ({ ...current, scheduleType: event.target.value }))
                    }
                  >
                    <option value="fixed_times">fixed times</option>
                    <option value="interval">interval</option>
                    <option value="titration">titration</option>
                  </select>
                  <select
                    className={field}
                    name="protocol-rebase-mode"
                    value={protocol.rebaseMode}
                    onChange={(event) =>
                      setProtocol((current) => ({ ...current, rebaseMode: event.target.value }))
                    }
                  >
                    <option value="fixed_anchor">fixed anchor</option>
                    <option value="rolling">rolling</option>
                  </select>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <input
                    className={field}
                    name="protocol-target-dose"
                    autoComplete="off"
                    value={protocol.targetDose}
                    onChange={(event) =>
                      setProtocol((current) => ({ ...current, targetDose: event.target.value }))
                    }
                    placeholder="Target dose"
                  />
                  <select
                    className={field}
                    name="protocol-dose-input-unit"
                    value={protocol.doseInputUnit}
                    onChange={(event) =>
                      setProtocol((current) => ({
                        ...current,
                        doseInputUnit: event.target.value,
                      }))
                    }
                  >
                    <option value="">Choose dose unit</option>
                    {["mcg", "mg", "ml", "units"].map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <select
                    className={field}
                    name="protocol-dose-basis"
                    value={protocol.doseBasis}
                    onChange={(event) =>
                      setProtocol((current) => ({ ...current, doseBasis: event.target.value }))
                    }
                  >
                    <option value="">Choose dose basis</option>
                    <option value="per_injection">per injection</option>
                    <option value="per_week">per week</option>
                    </select>
                  </div>
                {perWeekBlocked && (
                  <p className="text-xs text-warn">
                    Per-week dosing needs a schedule with a known injection frequency.
                  </p>
                )}
                <div className="grid gap-3 md:grid-cols-3">
                  <label className={label}>
                    Start date
                    <input
                      type="date"
                      className={field + " mt-1"}
                      name="protocol-start-date"
                      autoComplete="off"
                      value={protocol.startDate}
                      onInput={(event) => {
                        const value = event.currentTarget.value;
                        setProtocol((current) => ({ ...current, startDate: value }));
                      }}
                      onChange={(event) =>
                        setProtocol((current) => ({ ...current, startDate: event.target.value }))
                      }
                    />
                  </label>
                  <label className={label}>
                    End date
                    <input
                      type="date"
                      className={field + " mt-1"}
                      name="protocol-end-date"
                      autoComplete="off"
                      value={protocol.endDate}
                      onInput={(event) => {
                        const value = event.currentTarget.value;
                        setProtocol((current) => ({ ...current, endDate: value }));
                      }}
                      onChange={(event) =>
                        setProtocol((current) => ({ ...current, endDate: event.target.value }))
                      }
                    />
                  </label>
                  {singleInjection && (
                    <label className={label}>
                      Default syringe
                      <select
                        className={field + " mt-1"}
                        name="protocol-default-syringe-id"
                        value={protocol.defaultSyringeId}
                        onChange={(event) =>
                          setProtocol((current) => ({
                            ...current,
                            defaultSyringeId: event.target.value,
                          }))
                        }
                      >
                        <option value="">None</option>
                        {syringes.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <ScheduleEditor
                  value={protocol.scheduleRule}
                  onChange={(next) => setProtocol((current) => ({ ...current, scheduleRule: next }))}
                />
              </div>
            )}
          </section>
        )}

        {directionsRequired && (
          <label className="flex items-start gap-2 rounded-control bg-surface px-3 py-3 text-sm text-muted ring-1 ring-line/15">
            <input
              type="checkbox"
              className="mt-0.5"
              name="directions-confirmed"
              checked={directionsConfirmed}
              onChange={(event) => setDirectionsConfirmed(event.target.checked)}
            />
            <span>Dose and schedule copied from the prescription or label.</span>
          </label>
        )}

        {error && <p className="rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        {result?.ok && (
          <div className="rounded-card bg-ok/10 p-4 ring-1 ring-ok/20">
            <p className="font-medium text-ok">Tracking setup created.</p>
            {result.warnings?.length ? (
              <ul className="mt-2 space-y-1 text-sm text-ok">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <Link href="/inventory" className="font-medium text-accentStrong">
                Inventory
              </Link>
              <Link href="/today" className="font-medium text-accentStrong">
                Today
              </Link>
              <Link href="/prescriptions" className="font-medium text-accentStrong">
                Prescriptions
              </Link>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={
            Boolean(result?.ok) ||
            isPending ||
            (directionsRequired && !directionsConfirmed) ||
            (target === "peptide" && protocol.enabled && perWeekBlocked)
          }
          className="flex w-full items-center justify-center gap-2 rounded-control bg-accent px-4 py-3 font-medium text-onAccent disabled:opacity-40"
        >
          {isPending ? "Saving…" : <><Save className="h-4 w-4" aria-hidden /> Create tracking setup</>}
        </button>
      </div>

      <aside className="xl:sticky xl:top-6 h-fit rounded-card bg-surface p-4 shadow-sm ring-1 ring-line/10">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Review</p>
        <div className="mt-3 space-y-3 text-sm">
          <div>
            <p className="text-xs text-muted">Target</p>
            <p className="font-medium capitalize">{target}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Name</p>
            <p className="font-medium">{reviewName}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Script source</p>
            <p className="font-medium">{prescription.source || "Not set"}</p>
          </div>
          {target === "peptide" && (
            <>
              <div>
                <p className="text-xs text-muted">Route</p>
                <p className="font-medium">{singleRoute}</p>
              </div>
              {singleInjection && (
                <div>
                  <p className="text-xs text-muted">Vial</p>
                  <p className="font-medium">
                    {vial.labelStrengthMg || preparationPreview.totalMg || "Pending strength"} mg
                  </p>
                </div>
              )}
              {singleInjection && preparation.enabled && (
                <div>
                  <p className="text-xs text-muted">Concentration preview</p>
                  <p className="font-medium">
                    {preparationPreview.concentrationMcgPerMl
                      ? `${(Number(preparationPreview.concentrationMcgPerMl) / 1000).toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })} mg/mL`
                      : "Pending prep math"}
                  </p>
                </div>
              )}
              {protocol.enabled && (
                <div>
                  <p className="text-xs text-muted">Protocol preview</p>
                  <p className="font-medium">
                    {protocol.name || "Protocol"} · {scheduleSummary(parseSchedule(protocol.scheduleRule))}
                  </p>
                </div>
              )}
            </>
          )}
          {target === "stack" && (
            <div>
              <p className="text-xs text-muted">Components</p>
              <ul className="mt-1 space-y-1">
                {components.map((component) => (
                  <li key={component.key} className="rounded-control bg-bg px-2.5 py-2 ring-1 ring-line/10">
                    <p className="font-medium">{component.peptideName || "Unnamed component"}</p>
                    <p className="text-xs text-muted">
                      {component.qty || "0"} vial(s) · {component.doseMl || "0"} mL
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>

      <datalist id="wizard-peptide-names">
        {allPeptideNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </div>
  );
}
