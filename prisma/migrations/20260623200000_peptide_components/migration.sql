-- Custom-stack recipe: JSON array of {name, mg?} components. NULL for normal peptides.
ALTER TABLE "Peptide" ADD COLUMN "components" TEXT;
