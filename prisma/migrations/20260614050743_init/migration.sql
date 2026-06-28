-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecret" TEXT,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Peptide" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "aliases" TEXT,
    "category" TEXT,
    "substanceClass" TEXT NOT NULL DEFAULT 'mass',
    "defaultStrengthMg" DECIMAL,
    "halfLifeHours" DECIMAL,
    "minIntervalHours" DECIMAL,
    "missedDosePolicy" TEXT NOT NULL DEFAULT 'prompt',
    "storageNotes" TEXT,
    CONSTRAINT "Peptide_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "peptideId" TEXT NOT NULL,
    "prescriber" TEXT,
    "pharmacy" TEXT,
    "source" TEXT,
    "cost" DECIMAL,
    "currency" TEXT DEFAULT 'AUD',
    "quantity" INTEGER,
    "refillsAuthorized" INTEGER,
    "refillsRemaining" INTEGER,
    "dateWritten" DATETIME,
    "nextRefill" DATETIME,
    "expiration" DATETIME,
    "doseInstructions" TEXT,
    "sourceDocumentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT "Prescription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Prescription_peptideId_fkey" FOREIGN KEY ("peptideId") REFERENCES "Peptide" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Prescription_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Vial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "peptideId" TEXT NOT NULL,
    "prescriptionId" TEXT,
    "labelStrengthMg" DECIMAL NOT NULL,
    "lot" TEXT,
    "expiry" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'sealed',
    "storageLocation" TEXT,
    "openedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "Vial_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Vial_peptideId_fkey" FOREIGN KEY ("peptideId") REFERENCES "Peptide" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Vial_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Preparation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vialId" TEXT NOT NULL,
    "prepType" TEXT NOT NULL,
    "bacWaterMl" DECIMAL,
    "totalMg" DECIMAL NOT NULL,
    "concentrationMcgPerMl" DECIMAL NOT NULL,
    "reconstitutedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "beyondUseDate" DATETIME,
    "remainingMl" DECIMAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    CONSTRAINT "Preparation_vialId_fkey" FOREIGN KEY ("vialId") REFERENCES "Vial" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Syringe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "graduationType" TEXT NOT NULL,
    "unitsPerMl" INTEGER NOT NULL DEFAULT 100,
    "capacityMl" DECIMAL NOT NULL,
    "capacityUnits" INTEGER NOT NULL,
    "increment" DECIMAL NOT NULL,
    CONSTRAINT "Syringe_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Protocol" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "peptideId" TEXT NOT NULL,
    "prescriptionId" TEXT,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "scheduleType" TEXT NOT NULL DEFAULT 'fixed_times',
    "scheduleRule" TEXT,
    "rebaseMode" TEXT NOT NULL DEFAULT 'fixed_anchor',
    "adherenceWindowMin" INTEGER NOT NULL DEFAULT 120,
    "defaultSyringeId" TEXT,
    "targetDose" DECIMAL,
    "doseInputUnit" TEXT NOT NULL DEFAULT 'mcg',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT "Protocol_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Protocol_peptideId_fkey" FOREIGN KEY ("peptideId") REFERENCES "Peptide" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Protocol_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProtocolStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "protocolId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "dose" DECIMAL NOT NULL,
    "doseInputUnit" TEXT NOT NULL,
    "durationDays" INTEGER,
    "notes" TEXT,
    CONSTRAINT "ProtocolStep_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "Protocol" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlannedDose" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "protocolId" TEXT NOT NULL,
    "scheduledAt" DATETIME NOT NULL,
    "targetDose" DECIMAL,
    "doseInputUnit" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "generatedFromStep" INTEGER,
    "reminderSentAt" DATETIME,
    CONSTRAINT "PlannedDose_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlannedDose_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "Protocol" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DoseLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "clientUuid" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "protocolId" TEXT,
    "plannedDoseId" TEXT,
    "takenAt" DATETIME NOT NULL,
    "scheduledAt" DATETIME,
    "deltaMinutes" INTEGER,
    "doseMcg" DECIMAL NOT NULL,
    "doseInputUnit" TEXT NOT NULL,
    "volumeMl" DECIMAL NOT NULL,
    "syringeUnits" DECIMAL,
    "syringeId" TEXT,
    "injectionSite" TEXT,
    "source" TEXT NOT NULL DEFAULT 'app',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DoseLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DoseLog_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "Preparation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DoseLog_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "Protocol" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DoseLog_plannedDoseId_fkey" FOREIGN KEY ("plannedDoseId") REFERENCES "PlannedDose" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DoseLog_syringeId_fkey" FOREIGN KEY ("syringeId") REFERENCES "Syringe" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "weight" DECIMAL,
    "weightUnit" TEXT,
    "mood" INTEGER,
    "energy" INTEGER,
    "sleep" DECIMAL,
    "sideEffects" TEXT,
    "doseLogId" TEXT,
    "notes" TEXT,
    CONSTRAINT "JournalEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mime" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extractionStatus" TEXT NOT NULL DEFAULT 'pending',
    "extractionConfidence" DECIMAL,
    CONSTRAINT "Document_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Biomarker" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "defaultUnit" TEXT,
    "category" TEXT,
    "optimalLow" DECIMAL,
    "optimalHigh" DECIMAL
);

-- CreateTable
CREATE TABLE "LabPanel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "collectedDate" DATETIME NOT NULL,
    "labSource" TEXT,
    "documentId" TEXT,
    "notes" TEXT,
    CONSTRAINT "LabPanel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LabPanel_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "labPanelId" TEXT NOT NULL,
    "biomarkerId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "unit" TEXT,
    "referenceLow" DECIMAL,
    "referenceHigh" DECIMAL,
    "flag" TEXT,
    CONSTRAINT "LabResult_labPanelId_fkey" FOREIGN KEY ("labPanelId") REFERENCES "LabPanel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LabResult_biomarkerId_fkey" FOREIGN KEY ("biomarkerId") REFERENCES "Biomarker" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DoseLog_clientUuid_key" ON "DoseLog"("clientUuid");

-- CreateIndex
CREATE UNIQUE INDEX "DoseLog_plannedDoseId_key" ON "DoseLog"("plannedDoseId");

-- CreateIndex
CREATE UNIQUE INDEX "Biomarker_name_key" ON "Biomarker"("name");
