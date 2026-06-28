-- Peptide stacks: a named group over real volume-dosed protocols.
CREATE TABLE "Stack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Stack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Link protocols to a stack (nullable; normal protocols stay null).
ALTER TABLE "Protocol" ADD COLUMN "stackId" TEXT REFERENCES "Stack" ("id");

-- Retire the dry-powder custom-stack column (DEV-only, no prod data).
ALTER TABLE "Peptide" DROP COLUMN "components";
