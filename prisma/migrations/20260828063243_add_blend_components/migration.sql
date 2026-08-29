-- CreateTable
CREATE TABLE "BlendComponent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "peptideId" TEXT NOT NULL,
    "componentPeptideId" TEXT NOT NULL,
    "massMg" DECIMAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'label',
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BlendComponent_peptideId_fkey" FOREIGN KEY ("peptideId") REFERENCES "Peptide" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BlendComponent_componentPeptideId_fkey" FOREIGN KEY ("componentPeptideId") REFERENCES "Peptide" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BlendComponent_componentPeptideId_idx" ON "BlendComponent"("componentPeptideId");

-- CreateIndex
CREATE UNIQUE INDEX "BlendComponent_peptideId_componentPeptideId_key" ON "BlendComponent"("peptideId", "componentPeptideId");
