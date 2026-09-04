/**
 * Sample/demo data for local development — NO real personal data.
 *
 * Gives a fresh install a populated, in-progress demo: a couple of common research
 * peptides with half-lives, reconstituted vials, ~4 weeks of dose history (so
 * adherence, the heatmap, and plasma-level curves render), a titrating protocol +
 * fixed ones, a small illustrative bloodwork panel, two made-up DEXA scans with
 * an RMR test, an illness window, and four weeks of made-up Garmin wellness and
 * training rows (so the body figure, LSC deltas and the Training card render).
 * All values are made-up examples. The owner is created UNPROVISIONED so first run forces /setup
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
  await prisma.ecgRecording.deleteMany();
  await prisma.metabolicTest.deleteMany(); // RESTRICT FK to BodyCompScan → before scans
  await prisma.bodyCompRegion.deleteMany();
  await prisma.bodyCompScan.deleteMany();
  await prisma.bodyCompPrecision.deleteMany();
  await prisma.lifeEvent.deleteMany();
  await prisma.wearableDaily.deleteMany();
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
  // BlendComponent holds a RESTRICT FK to Peptide — without this the reseed
  // aborts on P2003 AFTER the tables above are already wiped.
  await prisma.blendComponent.deleteMany();
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
    // Aliases stay within TB-500's own identity: "Thymosin Beta-4" / "TB4" belong to
    // the DISTINCT library entry of that name, and listing them here would both
    // re-conflate the two compounds and hide that entry from "Add from library".
    data: { userId: user.id, name: "TB-500", aliases: JSON.stringify(["Ac-LKKTETQ"]), category: "healing", substanceClass: "mass", halfLifeHours: "60", missedDosePolicy: "take_now" },
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
  // Canonical codes from src/lib/sites.ts — unrecognised values are silently
  // ignored there, which would leave the demo BodyMap empty despite the doses below.
  const sites = ["abdomen_L", "abdomen_R", "thigh_L", "thigh_R"];
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


  // ── Demo body composition (DEXA + RMR) ─────────────────────────────────────
  // Two made-up whole-body DEXA scans ten weeks apart for a fictional 38-year-old,
  // 178 cm male. Region rows sum to the totals (the lib checksums them) and the
  // fat change clears the default LSC band while the lean change sits inside it,
  // so the delta table shows both a real move and a "within noise" one.
  const TZ = "Australia/Brisbane";
  const localDayOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const scanDevice = { modality: "dxa", deviceMake: "Hologic", deviceModel: "Horizon A", deviceSerial: "DEMO-0001", softwareVersion: "13.6", scanMode: "Auto Whole Body Fan Beam", facility: "Example Clinic", referencePopulation: "NHANES/BMDCS 2012 White Male" };
  const prepDone = { prepFasted: true, prepFastingHours: "10", prepNoCaffeine: true, prepNoTrainingPriorDay: true, prepActiveTravel: false, prepEuhydratedVoided: true, prepIllnessFree14d: true, creatineStatus: "none", carbPattern48h: "normal" };
  type DemoRegion = [string, number | null, number, number, number, number, number | null];
  // [region, bmcG, fatG, leanG, totalG, pctFat, bmdGcm2]
  const scanARegions: DemoRegion[] = [
    ["head", 520, 1150, 3650, 5320, 21.6, 2.35],
    ["l_arm", 220, 1020, 3780, 5020, 20.3, 0.92],
    ["r_arm", 230, 1060, 3940, 5230, 20.3, 0.94],
    ["trunk", 1050, 9800, 28900, 39750, 24.7, null],
    ["l_leg", 640, 2940, 9880, 13460, 21.8, 1.38],
    ["r_leg", 640, 2980, 10000, 13620, 21.9, 1.39],
    ["android", null, 1480, 4120, 5600, 26.4, null],
    ["gynoid", null, 3050, 9900, 12950, 23.6, null],
  ];
  const scanBRegions: DemoRegion[] = [
    ["head", 520, 1120, 3660, 5300, 21.1, 2.35],
    ["l_arm", 220, 950, 3830, 5000, 19.0, 0.93],
    ["r_arm", 230, 990, 3990, 5210, 19.0, 0.95],
    ["trunk", 1050, 9000, 29100, 39150, 23.0, null],
    ["l_leg", 640, 2760, 9980, 13380, 20.6, 1.38],
    ["r_leg", 640, 2780, 10140, 13560, 20.5, 1.40],
    ["android", null, 1340, 4180, 5520, 24.3, null],
    ["gynoid", null, 2860, 10000, 12860, 22.2, null],
  ];
  const regionRows = (rs: DemoRegion[]) => rs.map(([region, bmcG, fatG, leanG, totalG, pctFat, bmdGcm2]) => ({
    region, bmcG: bmcG == null ? null : enc(String(bmcG)), fatG: enc(String(fatG))!, leanG: enc(String(leanG))!, totalG: enc(String(totalG))!,
    pctFat: enc(String(pctFat))!, bmdGcm2: bmdGcm2 == null ? null : enc(String(bmdGcm2)),
  }));
  const scanAAt = new Date(Date.now() - 70 * DAY); scanAAt.setHours(9, 15, 0, 0);
  const scanBAt = new Date(Date.now() - 7 * DAY); scanBAt.setHours(9, 40, 0, 0);
  await prisma.bodyCompScan.create({
    data: {
      userId: user.id, scannedAt: scanAAt, localDay: localDayOf(scanAAt), tz: TZ, ...scanDevice,
      sex: "male", ageYears: "38", heightCm: "178", clinicWeightKg: enc("82.6"),
      totalFatG: enc("18950")!, totalLeanG: enc("60150")!, totalBmcG: enc("3300")!, totalMassG: enc("82400")!, pctFat: enc("23.0")!,
      pctFatYn: enc("62"), pctFatAm: enc("48"),
      vatMassG: enc("520"), vatVolumeCm3: enc("560"), vatAreaCm2: enc("108"),
      totalBmdGcm2: enc("1.26"), bmdZScore: enc("0.8"), bmdCvPct: "1.0",
      ...prepDone, regions: { create: regionRows(scanARegions) },
    },
  });
  const scanB = await prisma.bodyCompScan.create({
    data: {
      userId: user.id, scannedAt: scanBAt, localDay: localDayOf(scanBAt), tz: TZ, ...scanDevice,
      sex: "male", ageYears: "38", heightCm: "178", clinicWeightKg: enc("81.9"),
      totalFatG: enc("17600")!, totalLeanG: enc("60700")!, totalBmcG: enc("3300")!, totalMassG: enc("81600")!, pctFat: enc("21.6")!,
      pctFatYn: enc("55"), pctFatAm: enc("41"),
      vatMassG: enc("470"), vatVolumeCm3: enc("505"), vatAreaCm2: enc("98"),
      totalBmdGcm2: enc("1.27"), bmdZScore: enc("0.9"), bmdCvPct: "1.0",
      ...prepDone, regions: { create: regionRows(scanBRegions) },
    },
  });
  // One made-up indirect-calorimetry RMR test on the second scan's visit.
  const rmrAt = new Date(scanBAt.getTime() + 45 * 60 * 1000);
  await prisma.metabolicTest.create({
    data: {
      userId: user.id, testedAt: rmrAt, localDay: localDayOf(rmrAt), tz: TZ, method: "ic_vo2_only",
      deviceLabel: "VO2-only analyser", facility: "Example Clinic",
      measuredRmrKcal: enc("1790")!, kcalPerLitreO2: enc("4.81"), durationMin: 15, steadyStateCvPct: enc("6.5"),
      sex: "male", ageYears: "38", heightCm: "178", weightKg: enc("81.9")!,
      reportedPredictedKcal: enc("1820"), reportedPredictionEquation: "Mifflin-St Jeor",
      prepFasted: true, prepFastingHours: "10", prepNoCaffeine: true, prepNoTrainingPriorDay: true, prepActiveTravel: false,
      prepRestMinBeforeTest: 20, prepRested: true, prepIllnessFree14d: true, prepAwakeQuiet: true, roomTempC: "22",
      bodyCompScanId: scanB.id,
    },
  });
  // A short illness window between the scans (shaded on charts, excluded from intervals).
  const illStart = new Date(today.getTime() - 40 * DAY);
  const illEnd = new Date(today.getTime() - 38 * DAY);
  await prisma.lifeEvent.create({
    data: { userId: user.id, kind: "illness", startDay: localDayOf(illStart), endDay: localDayOf(illEnd), label: "head cold" },
  });

  // ── Demo Garmin wellness + training rows ───────────────────────────────────
  // Four weeks of made-up daily rows shaped like the sync sidecar's output, so the
  // wellness charts and the Training card (readiness, load ratio, endurance and
  // hill scores, fitness age, lactate threshold) have something to draw.
  const wearRows = [];
  for (let d = 27; d >= 0; d--) {
    const day = new Date(today.getTime() - d * DAY);
    const i = 27 - d;
    const wave = Math.sin(i / 3.1); // gentle, deterministic day-to-day variation
    const readiness = Math.round(64 + 18 * wave + (i % 5 === 0 ? -12 : 0));
    const level = readiness >= 85 ? "PRIME" : readiness >= 70 ? "HIGH" : readiness >= 50 ? "MODERATE" : "LOW";
    const acute = Math.round(420 + 90 * Math.sin(i / 4.5));
    const chronic = Math.round(400 + i * 1.5);
    const acwr = +(acute / chronic).toFixed(2);
    wearRows.push({
      userId: user.id, date: day, source: "garmin",
      sleepSeconds: Math.round((6.6 + 0.9 * wave) * 3600), sleepDeepSeconds: Math.round((1.2 + 0.2 * wave) * 3600),
      sleepLightSeconds: Math.round((3.6 + 0.5 * wave) * 3600), sleepRemSeconds: Math.round((1.5 + 0.2 * wave) * 3600),
      sleepAwakeSeconds: Math.round(0.3 * 3600), sleepScore: Math.round(74 + 12 * wave),
      restingHr: Math.round(50 - 2 * wave), hrvMs: String(Math.round(62 + 9 * wave)), hrvStatus: wave > -0.5 ? "balanced" : "unbalanced",
      bodyBatteryHigh: Math.round(88 + 8 * wave), bodyBatteryLow: Math.round(18 + 6 * wave), stressAvg: Math.round(28 - 6 * wave),
      weightKg: (82.4 - i * 0.03).toFixed(1), bmi: (26.0 - i * 0.01).toFixed(1), bodyFatPct: (21.8 - i * 0.02).toFixed(1),
      steps: Math.round(8600 + 2400 * Math.sin(i / 2.2)), caloriesActive: Math.round(560 + 220 * Math.sin(i / 2.2)),
      vo2max: "51", intensityMinutes: i % 2 === 0 ? 45 : 20, spo2Avg: 97, respirationAvg: "14.2",
      trainingReadiness: readiness, trainingReadinessLevel: level,
      acuteLoad: acute, chronicLoad: chronic, acwr: String(acwr), acwrStatus: acwr < 0.8 ? "LOW" : acwr > 1.3 ? "HIGH" : "OPTIMAL",
      trainingStatus: i % 7 === 3 ? "MAINTAINING" : "PRODUCTIVE",
      enduranceScore: 6100 + i * 6, hillScore: 54 + Math.round(i / 9), fitnessAge: (33.8 - i * 0.02).toFixed(1),
      ltHr: 165, ltSpeedMs: "3.90", floorsClimbed: 8 + (i % 6), restingHr7d: 50,
      activityCount: i % 2 === 0 ? 1 : 0,
    });
  }
  await prisma.wearableDaily.createMany({ data: wearRows });

  console.log(`Seed complete: 3 demo peptides, 2 reconstitutions, ${logs.length} dose logs, 3 protocols, ${results.length} sample lab results, 2 demo DEXA scans + 1 RMR test, ${wearRows.length} demo wearable days.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
