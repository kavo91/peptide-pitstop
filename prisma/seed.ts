/**
 * Sample/demo data for local development — NO real personal data.
 *
 * Gives a fresh install a populated, in-progress demo: a couple of common research
 * peptides with half-lives, reconstituted vials, ~4 weeks of dose history (so
 * adherence, the heatmap, and plasma-level curves render), a titrating protocol +
 * fixed ones, and a small illustrative bloodwork panel. All values are made-up
 * examples. The owner is created UNPROVISIONED so first run forces /setup
 * (password + TOTP).
 *
 * Run: PT_FIELD_KEY=... npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import { encryptField } from "../src/lib/crypto/fieldEncryption";
import { assertSeedAllowed } from "../src/lib/seed-guard";

const prisma = new PrismaClient();
// Encrypt only if a key is configured; otherwise seed plaintext (dev convenience).
const enc = (s: string | null): string | null =>
  process.env.PT_FIELD_KEY ? encryptField(s) : s;

const DAY = 24 * 60 * 60 * 1000;
// Cycle start ~4 weeks ago so the demo looks in-progress: the titration sits
// mid-ramp, recent adherence + plasma data populate, and the edit-chart "now"
// marker lands mid-chart.
const CYCLE_START = new Date(Date.now() - 28 * DAY);

async function main() {
  // Defence in depth: this seed is destructive (wipes data + resets the owner to
  // unprovisioned, reopening /setup). Never let it run against a real DB.
  assertSeedAllowed(process.env);

  // Idempotent: clear existing data (child → parent order) so re-running is safe.
  await prisma.doseLog.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.plannedDose.deleteMany();
  await prisma.labResult.deleteMany();
  await prisma.labPanel.deleteMany();
  await prisma.protocolStep.deleteMany();
  await prisma.protocol.deleteMany();
  await prisma.preparation.deleteMany();
  await prisma.vial.deleteMany();
  await prisma.prescription.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.peptide.deleteMany();
  await prisma.biomarker.deleteMany();
  await prisma.syringe.deleteMany();
  await prisma.document.deleteMany();

  const user = await prisma.user.upsert({
    where: { email: "owner@example.com" },
    update: { passwordHash: "", totpSecret: null },
    create: { email: "owner@example.com", passwordHash: "", totpSecret: null, role: "owner" },
  });

  // Syringe library.
  const syr1ml = await prisma.syringe.create({
    data: { userId: user.id, name: "1 mL U-100 insulin", graduationType: "units", unitsPerMl: 100, capacityMl: "1", capacityUnits: 100, increment: "1" },
  });
  await prisma.syringe.create({
    data: { userId: user.id, name: "0.5 mL U-100 insulin", graduationType: "units", unitsPerMl: 100, capacityMl: "0.5", capacityUnits: 50, increment: "1" },
  });

  // Demo peptides — common research peptides used here purely as examples.
  // halfLifeHours are illustrative (drive the plasma-curve estimate).
  const bpc = await prisma.peptide.create({
    data: { userId: user.id, name: "BPC-157", category: "healing", substanceClass: "mass", halfLifeHours: "6", missedDosePolicy: "take_now" },
  });
  const tb4 = await prisma.peptide.create({
    data: { userId: user.id, name: "TB-500", aliases: JSON.stringify(["Thymosin Beta-4", "TB4"]), category: "healing", substanceClass: "mass", halfLifeHours: "60", missedDosePolicy: "take_now" },
  });
  const ipa = await prisma.peptide.create({
    data: { userId: user.id, name: "Ipamorelin", category: "growth", substanceClass: "mass", defaultStrengthMg: "10", halfLifeHours: "2", missedDosePolicy: "prompt" },
  });

  // A demo prescription (example pharmacy) for one peptide.
  const rx = await prisma.prescription.create({
    data: {
      userId: user.id, peptideId: ipa.id, source: "Example Pharmacy",
      doseInstructions: enc("200 mcg once daily before bed"),
      refillsRemaining: 3, nextRefill: new Date(Date.now() + 20 * DAY), expiration: new Date(Date.now() + 300 * DAY),
      status: "active",
    },
  });

  // Vials: BPC-157 + Ipamorelin reconstituted (in use, with dose history below);
  // TB-500 left sealed so the reconstitution wizard has something to run on.
  const bpcVial = await prisma.vial.create({
    data: { userId: user.id, peptideId: bpc.id, labelStrengthMg: "5", status: "in_use", openedAt: CYCLE_START },
  });
  await prisma.vial.create({
    data: { userId: user.id, peptideId: tb4.id, labelStrengthMg: "10", status: "sealed" },
  });
  const ipaVial = await prisma.vial.create({
    data: { userId: user.id, peptideId: ipa.id, prescriptionId: rx.id, labelStrengthMg: "10", status: "in_use", openedAt: CYCLE_START },
  });

  // Reconstitutions (concentration drives the draw-volume math).
  const bpcPrep = await prisma.preparation.create({
    data: { vialId: bpcVial.id, prepType: "reconstituted", bacWaterMl: "2.5", totalMg: "5", concentrationMcgPerMl: "2000", remainingMl: "1.6", reconstitutedAt: CYCLE_START, active: true },
  });
  const ipaPrep = await prisma.preparation.create({
    data: { vialId: ipaVial.id, prepType: "reconstituted", bacWaterMl: "2", totalMg: "10", concentrationMcgPerMl: "5000", remainingMl: "1.4", reconstitutedAt: CYCLE_START, active: true },
  });

  // Protocols: BPC-157 with a 2-week titration ramp; TB-500 fixed twice-weekly;
  // Ipamorelin daily (from the demo prescription).
  const bpcProtocol = await prisma.protocol.create({
    data: {
      userId: user.id, peptideId: bpc.id, name: "BPC-157 daily (titrating)",
      source: "manual", scheduleType: "titration", scheduleRule: "FREQ=DAILY",
      rebaseMode: "rolling", targetDose: "400", doseInputUnit: "mcg", defaultSyringeId: syr1ml.id, startDate: CYCLE_START, status: "active",
    },
  });
  await prisma.protocolStep.createMany({
    data: [
      { protocolId: bpcProtocol.id, stepIndex: 0, dose: "250", doseInputUnit: "mcg", durationDays: 14, notes: "Titration start" },
      { protocolId: bpcProtocol.id, stepIndex: 1, dose: "400", doseInputUnit: "mcg", durationDays: null, notes: "Maintenance" },
    ],
  });
  await prisma.protocol.create({
    data: {
      userId: user.id, peptideId: tb4.id, name: "TB-500 (Mon/Thu)",
      source: "manual", scheduleType: "fixed_times", scheduleRule: "FREQ=WEEKLY;BYDAY=MO,TH",
      rebaseMode: "fixed_anchor", targetDose: "2.5", doseInputUnit: "mg", defaultSyringeId: syr1ml.id, startDate: CYCLE_START, status: "active",
    },
  });
  const ipaProtocol = await prisma.protocol.create({
    data: {
      userId: user.id, peptideId: ipa.id, prescriptionId: rx.id, name: "Ipamorelin daily",
      source: "prescription", scheduleType: "fixed_times", scheduleRule: "FREQ=DAILY",
      rebaseMode: "rolling", targetDose: "200", doseInputUnit: "mcg", defaultSyringeId: syr1ml.id, startDate: CYCLE_START, status: "active",
    },
  });

  // ── Demo dose history ──────────────────────────────────────────────────────
  // ~4 weeks of daily BPC-157 + Ipamorelin logs (a couple skipped for realistic
  // <100% adherence) so adherence, the heatmap, and plasma curves populate.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sites = ["abdomen L", "abdomen R", "thigh L", "thigh R"];
  let n = 0;
  const logs = [];
  for (let d = 28; d >= 0; d--) {
    if (d === 9 || d === 17) continue; // two missed days
    const day = new Date(today.getTime() - d * DAY);
    const ageDays = 28 - d;
    const bpcMcg = ageDays < 14 ? 250 : 400; // titration → maintenance
    logs.push({
      userId: user.id, clientUuid: `demo-bpc-${n}`, preparationId: bpcPrep.id, protocolId: bpcProtocol.id,
      takenAt: new Date(day.getTime() + 8 * 60 * 60 * 1000 + (n % 25) * 60 * 1000),
      doseMcg: String(bpcMcg), doseInputUnit: "mcg", volumeMl: String(+(bpcMcg / 2000).toFixed(3)),
      syringeId: syr1ml.id, injectionSite: sites[n % 4], route: "injection", source: "app",
    });
    n++;
    logs.push({
      userId: user.id, clientUuid: `demo-ipa-${n}`, preparationId: ipaPrep.id, protocolId: ipaProtocol.id,
      takenAt: new Date(day.getTime() + 21 * 60 * 60 * 1000 + (n % 25) * 60 * 1000),
      doseMcg: "200", doseInputUnit: "mcg", volumeMl: "0.04",
      syringeId: syr1ml.id, injectionSite: sites[n % 2], route: "injection", source: "app",
    });
    n++;
  }
  await prisma.doseLog.createMany({ data: logs });

  // A small ILLUSTRATIVE bloodwork panel (made-up, all in-range example values).
  const results: [string, string | null, string, string | null, string | null, string][] = [
    ["CRP", "mg/L", "1.0", null, "4", "normal"],
    ["Glucose (fasting)", "mmol/L", "5.0", "3.0", "6.0", "normal"],
    ["Creatinine", "umol/L", "85", "60", "130", "normal"],
    ["ALT", "U/L", "25", "0", "45", "normal"],
    ["Haemoglobin", "g/L", "150", "135", "180", "normal"],
    ["Ferritin", "ug/L", "150", "30", "320", "normal"],
    ["Vitamin D3", "nmol/L", "90", "49", null, "normal"],
  ];
  const panel = await prisma.labPanel.create({
    data: { userId: user.id, collectedDate: new Date(Date.now() - 20 * DAY), labSource: "Example Lab" },
  });
  for (const [name, unit, value, lo, hi, flag] of results) {
    const biomarker = await prisma.biomarker.upsert({
      where: { name }, update: {}, create: { name, defaultUnit: unit || null },
    });
    await prisma.labResult.create({
      data: {
        labPanelId: panel.id, biomarkerId: biomarker.id,
        value: enc(value)!, unit: unit || null,
        referenceLow: lo, referenceHigh: hi, flag,
      },
    });
  }

  console.log(`Seed complete: 3 demo peptides, 2 reconstitutions, ${logs.length} dose logs, 3 protocols, ${results.length} sample lab results.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
