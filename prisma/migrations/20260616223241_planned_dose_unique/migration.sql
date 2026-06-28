-- CreateIndex
CREATE UNIQUE INDEX "PlannedDose_protocolId_scheduledAt_key"
  ON "PlannedDose"("protocolId", "scheduledAt");
