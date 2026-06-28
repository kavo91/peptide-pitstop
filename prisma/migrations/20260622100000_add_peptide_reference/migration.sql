-- CreateTable
CREATE TABLE "PeptideReference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "peptideName" TEXT NOT NULL,
    "dataJson" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "PeptideReference_peptideName_key" ON "PeptideReference"("peptideName");
