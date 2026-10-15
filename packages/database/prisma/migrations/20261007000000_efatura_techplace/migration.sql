-- Techplace transport for e-Fatura: the sale's id/number there, and each Service's Techplace product id.
-- Additive only; the DNRE-direct columns are untouched until the DNRE code is retired.
ALTER TABLE "efatura_submissions" ADD COLUMN "externalId" VARCHAR(100),
ADD COLUMN "externalCode" VARCHAR(50);

CREATE UNIQUE INDEX "efatura_submissions_externalId_key" ON "efatura_submissions"("externalId");

ALTER TABLE "services" ADD COLUMN "techplaceProductId" VARCHAR(100);
