import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * createLabPanel's contract for report spellings: a variant name lands on the
 * existing canonical row, two rows for one biomarker are refused before any DB
 * call, and units are stored in the library spelling. The schema has no unique
 * (panel, biomarker) index, so the collision check is the only guard against a
 * repeat inside one panel.
 *
 * Every fixture is synthetic.
 */

type Row = { id: string; name: string; defaultUnit: string | null; optimalLow: string | null; optimalHigh: string | null };

const m = vi.hoisted(() => {
  const rows = new Map<string, Row>();
  let nextId = 1;
  const upsert = vi.fn(async (args: { where: { name: string }; create: Partial<Row> & { name: string }; update: Partial<Row> }) => {
    const cur = rows.get(args.where.name);
    if (cur) {
      Object.assign(cur, args.update);
      return cur;
    }
    const row: Row = { id: `b${nextId++}`, defaultUnit: null, optimalLow: null, optimalHigh: null, ...args.create };
    rows.set(row.name, row);
    return row;
  });
  const findMany = vi.fn(async (args: { where: { name: { in: string[] } } }) =>
    [...rows.values()].filter((r) => args.where.name.in.includes(r.name)),
  );
  const panelCreate = vi.fn(async (args: { data: unknown }) => ({ id: "panel1", ...(args.data as object) }));
  const auditCreate = vi.fn();
  const prisma: Record<string, unknown> = {
    biomarker: { upsert, findMany },
    labPanel: { create: panelCreate },
    auditLog: { create: auditCreate },
  };
  const transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  Object.assign(prisma, { $transaction: transaction });
  return {
    rows, prisma, upsert, findMany, panelCreate, transaction,
    reset: () => {
      rows.clear();
      nextId = 1;
    },
    currentUser: vi.fn(), revalidatePath: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/auth/owner", () => ({ getCurrentUser: m.currentUser }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/crypto/fieldEncryption", () => ({
  encryptField: (v: string | null | undefined) => (v == null ? null : `ENC(${v})`),
}));

import { createLabPanel } from "./bloodwork";

/** The result rows handed to labPanel.create. */
function savedResults(): { biomarkerId: string; unit: string | null; value: string }[] {
  const data = m.panelCreate.mock.calls[0][0].data as { results: { create: { biomarkerId: string; unit: string | null; value: string }[] } };
  return data.results.create;
}
const idOf = (name: string) => m.rows.get(name)?.id;

beforeEach(() => {
  vi.clearAllMocks();
  m.reset();
  m.currentUser.mockResolvedValue({ id: "u1" });
  // An earlier panel already created these rows under their canonical names.
  m.rows.set("GGT", { id: "ggt", name: "GGT", defaultUnit: "U/L", optimalLow: null, optimalHigh: null });
  m.rows.set("Zinc", { id: "zinc", name: "Zinc", defaultUnit: "umol/L", optimalLow: null, optimalHigh: null });
});

describe("createLabPanel — report spellings", () => {
  it("files a variant name on the existing canonical row, creating no parallel row", async () => {
    const res = await createLabPanel({
      collectedDate: "2027-03-08",
      results: [
        { biomarkerName: "Gamma GT (GGT)", value: "25", unit: "U/L" },
        { biomarkerName: "glucose (FASTING)", value: "5.2", unit: "mmol/L" },
      ],
    });
    expect(res.ok).toBe(true);
    expect(savedResults().map((r) => r.biomarkerId)).toEqual(["ggt", idOf("Glucose (fasting)")]);
    expect(m.rows.has("Gamma GT (GGT)")).toBe(false);
    expect(m.rows.has("glucose (FASTING)")).toBe(false);
  });

  it("refuses two rows for one biomarker before touching the DB", async () => {
    const res = await createLabPanel({
      collectedDate: "2027-03-08",
      results: [
        { biomarkerName: "Gamma GT", value: "25" },
        { biomarkerName: "GGT", value: "26" },
      ],
    });
    expect(res).toEqual({ ok: false, error: "Gamma GT and GGT are the same biomarker (GGT). Keep one row for each biomarker." });
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.findMany).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("refuses the same name twice", async () => {
    const res = await createLabPanel({
      collectedDate: "2027-03-08",
      results: [
        { biomarkerName: "Zinc", value: "12" },
        { biomarkerName: "Zinc ", value: "13" },
      ],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Zinc is listed twice. Keep one row for each biomarker.");
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("stores units in the library spelling, falling back to the biomarker's default, then null", async () => {
    const res = await createLabPanel({
      collectedDate: "2027-03-08",
      results: [
        { biomarkerName: "Zinc", value: "12", unit: "  " }, // blank → default "umol/L" → µmol/L
        { biomarkerName: "Ferritin", value: "120", unit: "ug/L" }, // entered spelling folded
        { biomarkerName: "Some Custom Marker", value: "1" }, // no unit, no default → null
      ],
    });
    expect(res.ok).toBe(true);
    expect(savedResults().map((r) => r.unit)).toEqual(["µmol/L", "µg/L", null]);
    expect(savedResults()[2].biomarkerId).toBe(idOf("Some Custom Marker")); // unknown names still become custom rows
  });

  it("keeps standard CRP and hs-CRP as two results in one panel", async () => {
    const res = await createLabPanel({
      collectedDate: "2027-01-11",
      results: [
        { biomarkerName: "CRP", value: "<3", unit: "mg/L" },
        { biomarkerName: "hsCRP", value: "0.6", unit: "mg/L" },
      ],
    });
    expect(res.ok).toBe(true);
    expect(savedResults().map((r) => r.biomarkerId)).toEqual([idOf("CRP"), idOf("CRP (hs)")]);
  });
});
