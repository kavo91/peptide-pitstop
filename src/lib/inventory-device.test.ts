import { beforeEach, describe, expect, it, vi } from "vitest";
import Decimal from "decimal.js";

// /inventory must size a dose on the protocol's REAL
// device — the one the logger draws with and the reorder tile forecasts with —
// and must never feed a raw weekly target into the volume maths.
const db = vi.hoisted(() => ({
  vials: [] as unknown[],
  protocols: [] as unknown[],
  syringes: [] as unknown[],
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    vial: { findMany: vi.fn(async () => db.vials) },
    protocol: { findMany: vi.fn(async () => db.protocols) },
    doseLog: { findMany: vi.fn(async () => []) },
    syringe: { findMany: vi.fn(async () => db.syringes) },
    user: { findUnique: vi.fn(async () => ({ reorderLeadTimeDays: 0, reorderBufferDays: 0 })) },
    prescription: { findMany: vi.fn(async () => []) },
  },
}));

import { getInventory } from "./inventory";
import { getReorderStatusUncached } from "./reorder";
import { computeDraw, dosesPerVial } from "./dosing/engine";
import { forecastSyringe } from "./forecast-syringe";

const D = (v: string) => new Decimal(v);
const NOW = new Date(2027, 9, 3, 12);
const peptide = { id: "pep", name: "Test Pep", defaultBudDays: 60, route: "nasal" };

const PUMP = { id: "pump", name: "Pump 0.1 mL", graduationType: "ml", deviceType: "pump", unitsPerMl: 100, capacityMl: D("10"), capacityUnits: 1000, increment: D("0.1"), userId: null };
const FINE = { id: "fine", name: "U-100 0.3 mL half-unit", graduationType: "units", deviceType: "syringe", unitsPerMl: 100, capacityMl: D("0.3"), capacityUnits: 30, increment: D("0.5"), userId: null };

function protocol(over: Record<string, unknown>) {
  return {
    id: "pr1", userId: "u1", peptideId: "pep", peptide, steps: [], prescription: null, prescriptionId: null, status: "active",
    doseBasis: "per_injection", targetDose: D("120"), doseInputUnit: "mcg", scheduleRule: "FREQ=DAILY", rebaseMode: "fixed_anchor",
    startDate: new Date(2027, 8, 1), endDate: null, adherenceWindowMin: 120, cycleOnWeeks: null, cycleOffWeeks: null, cycleAnchor: null,
    defaultSyringeId: "pump",
    ...over,
  };
}

function vial(preparations: unknown[]) {
  return {
    id: "v1", userId: "u1", peptideId: "pep", peptide, prescription: null, prescriptionId: null,
    labelStrengthMg: D("10"), status: preparations.length ? "in_use" : "sealed", lot: null, expiry: null, preparations,
  };
}

const prep = {
  id: "prep1", prepType: "reconstituted", concentrationMcgPerMl: D("1000"), remainingMl: D("3"), bacWaterMl: D("10"), totalMg: D("10"),
  reconstitutedAt: new Date(2027, 9, 1), beyondUseDate: new Date(2027, 11, 1), active: true,
};

beforeEach(() => {
  db.syringes = [PUMP, FINE];
});

describe("getInventory uses the protocol's real device", () => {
  for (const [label, dev, dose] of [["mL-graduated pump", PUMP, "120"], ["fine-step syringe", FINE, "125"]] as const) {
    it(`${label}: doses left and runs-out match the logger and the reorder tile`, async () => {
      db.vials = [vial([prep])];
      db.protocols = [protocol({ defaultSyringeId: dev.id, targetDose: D(dose) })];

      const [row] = await getInventory("u1", NOW);
      const [tile] = await getReorderStatusUncached("u1", NOW);

      const drawn = computeDraw({
        dose: { value: dose, unit: "mcg" },
        preparation: { prepType: "reconstituted", concentrationMcgPerMl: D("1000") },
        syringe: forecastSyringe(dev),
      }).deliveredVolumeMl;
      const expectedDoses = dosesPerVial({ totalVolumeMl: "3", doseVolumeMl: drawn.toString() }).toNumber();

      expect(row.remainingDoses).toBe(expectedDoses);
      expect(tile.status).not.toBe("covered");
      expect(tile.status).not.toBe("unknown");
      expect(row.daysLeft).toBe(tile.coverageDays);
    });
  }

  it("no device on the protocol → the U-100 default, same as the reorder tile", async () => {
    db.vials = [vial([prep])];
    db.protocols = [protocol({ defaultSyringeId: null, targetDose: D("125") })];
    const [row] = await getInventory("u1", NOW);
    const [tile] = await getReorderStatusUncached("u1", NOW);
    expect(row.daysLeft).toBe(tile.coverageDays);
  });
});

describe("getInventory fails safe on an unresolvable per-week dose", () => {
  it("per_week 700 with no schedule → no dose, no volume maths, no recon target", async () => {
    db.vials = [vial([])];
    db.protocols = [protocol({ doseBasis: "per_week", targetDose: D("700"), scheduleRule: null })];
    const [row] = await getInventory("u1", NOW);
    expect(row.recon?.targetDose).toBeUndefined();
    expect(row.remainingDoses).toBeNull();
  });

  it("per_week 700 with no schedule on a prepared vial → no counts", async () => {
    db.vials = [vial([prep])];
    db.protocols = [protocol({ doseBasis: "per_week", targetDose: D("700"), scheduleRule: null })];
    const [row] = await getInventory("u1", NOW);
    expect(row.remainingDoses).toBeNull();
    expect(row.daysLeft).toBeNull();
  });
});

describe("vial fill uses the prepared mass", () => {
  it("label 10 mg, 8 mg entered in 2 mL, 1 mL left → 50 % full", async () => {
    const p8 = { ...prep, totalMg: D("8"), bacWaterMl: D("2"), concentrationMcgPerMl: D("4000"), remainingMl: D("1") };
    db.vials = [vial([p8])];
    db.protocols = [];
    const { vialFill } = await import("./vial-fill");
    const [row] = await getInventory("u1", NOW);
    expect(vialFill(row)).toBeCloseTo(0.5, 10);
  });
});
