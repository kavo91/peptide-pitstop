-- CreateTable
CREATE TABLE "BodyCompScan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "scannedAt" DATETIME NOT NULL,
    "localDay" TEXT NOT NULL,
    "tz" TEXT NOT NULL,
    "modality" TEXT NOT NULL DEFAULT 'dxa',
    "deviceMake" TEXT,
    "deviceModel" TEXT,
    "deviceSerial" TEXT,
    "softwareVersion" TEXT,
    "scanMode" TEXT,
    "facility" TEXT,
    "referencePopulation" TEXT,
    "sex" TEXT NOT NULL,
    "ageYears" DECIMAL NOT NULL,
    "heightCm" DECIMAL NOT NULL,
    "clinicWeightKg" TEXT,
    "totalFatG" TEXT NOT NULL,
    "totalLeanG" TEXT NOT NULL,
    "totalBmcG" TEXT NOT NULL,
    "totalMassG" TEXT NOT NULL,
    "pctFat" TEXT NOT NULL,
    "pctFatYn" TEXT,
    "pctFatAm" TEXT,
    "vatMassG" TEXT,
    "vatVolumeCm3" TEXT,
    "vatAreaCm2" TEXT,
    "totalBmdGcm2" TEXT,
    "bmdTScore" TEXT,
    "bmdZScore" TEXT,
    "bmdCvPct" DECIMAL,
    "fmiYn" TEXT,
    "fmiAm" TEXT,
    "lmiYn" TEXT,
    "lmiAm" TEXT,
    "almiYn" TEXT,
    "almiAm" TEXT,
    "prepFasted" BOOLEAN,
    "prepFastingHours" DECIMAL,
    "prepNoCaffeine" BOOLEAN,
    "prepNoTrainingPriorDay" BOOLEAN,
    "prepActiveTravel" BOOLEAN,
    "prepEuhydratedVoided" BOOLEAN,
    "prepIllnessFree14d" BOOLEAN,
    "prepSameDeviceAsPrior" BOOLEAN,
    "creatineStatus" TEXT,
    "carbPattern48h" TEXT,
    "reportJson" TEXT,
    "documentId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BodyCompScan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BodyCompScan_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BodyCompRegion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scanId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "bmcG" TEXT,
    "fatG" TEXT NOT NULL,
    "leanG" TEXT NOT NULL,
    "totalG" TEXT NOT NULL,
    "pctFat" TEXT NOT NULL,
    "pctFatYn" TEXT,
    "pctFatAm" TEXT,
    "bmdGcm2" TEXT,
    CONSTRAINT "BodyCompRegion_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "BodyCompScan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MetabolicTest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "testedAt" DATETIME NOT NULL,
    "localDay" TEXT NOT NULL,
    "tz" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "facility" TEXT,
    "measuredRmrKcal" TEXT NOT NULL,
    "kcalPerLitreO2" TEXT,
    "vo2MlMin" TEXT,
    "vco2MlMin" TEXT,
    "rq" TEXT,
    "durationMin" INTEGER,
    "steadyStateCvPct" TEXT,
    "sex" TEXT NOT NULL,
    "ageYears" DECIMAL NOT NULL,
    "heightCm" DECIMAL NOT NULL,
    "weightKg" TEXT NOT NULL,
    "reportedPredictedKcal" TEXT,
    "reportedPredictionEquation" TEXT,
    "reportedActivityFactor" TEXT,
    "reportedActivityLabel" TEXT,
    "prepFasted" BOOLEAN,
    "prepFastingHours" DECIMAL,
    "prepNoCaffeine" BOOLEAN,
    "prepNoTrainingPriorDay" BOOLEAN,
    "prepActiveTravel" BOOLEAN,
    "prepRestMinBeforeTest" INTEGER,
    "prepIllnessFree14d" BOOLEAN,
    "prepAwakeQuiet" BOOLEAN,
    "roomTempC" DECIMAL,
    "bodyCompScanId" TEXT,
    "documentId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetabolicTest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MetabolicTest_bodyCompScanId_fkey" FOREIGN KEY ("bodyCompScanId") REFERENCES "BodyCompScan" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MetabolicTest_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BodyCompPrecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "deviceSerial" TEXT,
    "source" TEXT NOT NULL,
    "fatCvPct" DECIMAL,
    "leanCvPct" DECIMAL,
    "pctFatLscAbs" DECIMAL,
    "almCvPct" DECIMAL,
    "vatCvPct" DECIMAL,
    "bmdCvPct" DECIMAL,
    "rmrCvPct" DECIMAL,
    "practicalFatMultiplier" DECIMAL,
    "practicalLeanMultiplier" DECIMAL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BodyCompPrecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BodyCompScan_userId_scannedAt_idx" ON "BodyCompScan"("userId", "scannedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BodyCompRegion_scanId_region_key" ON "BodyCompRegion"("scanId", "region");

-- CreateIndex
CREATE INDEX "MetabolicTest_userId_testedAt_idx" ON "MetabolicTest"("userId", "testedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BodyCompPrecision_userId_deviceSerial_source_key" ON "BodyCompPrecision"("userId", "deviceSerial", "source");
