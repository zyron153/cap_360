-- CreateEnum
CREATE TYPE "EFaturaPurpose" AS ENUM ('issue', 'receipt', 'credit_note', 'cancel');

-- AlterEnum
ALTER TYPE "EFaturaStatus" ADD VALUE 'not_required';

-- DropForeignKey
ALTER TABLE "efatura_submissions" DROP CONSTRAINT "efatura_submissions_invoiceId_fkey";

-- DropIndex
DROP INDEX "efatura_submissions_invoiceId_key";

-- AlterTable
ALTER TABLE "efatura_submissions" DROP COLUMN "atcud",
DROP COLUMN "efaturaRef",
ADD COLUMN     "documentNumber" INTEGER,
ADD COLUMN     "documentTypeCode" INTEGER,
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "iud" VARCHAR(45),
ADD COLUMN     "ledCode" INTEGER,
ADD COLUMN     "paymentId" TEXT,
ADD COLUMN     "purpose" "EFaturaPurpose" NOT NULL DEFAULT 'issue',
ADD COLUMN     "reason" VARCHAR(500),
ADD COLUMN     "referencesId" TEXT,
ADD COLUMN     "repositoryCode" INTEGER,
ADD COLUMN     "serie" VARCHAR(20),
ADD COLUMN     "signedXml" TEXT,
ADD COLUMN     "year" INTEGER;

-- AlterTable
ALTER TABLE "invoice_items" ADD COLUMN     "taxExemptionReasonCode" INTEGER,
ADD COLUMN     "taxPercentage" DECIMAL(6,3),
ADD COLUMN     "taxTypeCode" VARCHAR(3);

-- CreateTable
CREATE TABLE "efatura_counters" (
    "year" INTEGER NOT NULL,
    "ledCode" INTEGER NOT NULL,
    "documentTypeCode" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "efatura_counters_pkey" PRIMARY KEY ("year","ledCode","documentTypeCode")
);

-- CreateIndex
CREATE UNIQUE INDEX "efatura_submissions_paymentId_key" ON "efatura_submissions"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "efatura_submissions_iud_key" ON "efatura_submissions"("iud");

-- CreateIndex
CREATE INDEX "efatura_submissions_invoiceId_idx" ON "efatura_submissions"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "efatura_submissions_year_ledCode_documentTypeCode_documentN_key" ON "efatura_submissions"("year", "ledCode", "documentTypeCode", "documentNumber");

-- AddForeignKey
ALTER TABLE "efatura_submissions" ADD CONSTRAINT "efatura_submissions_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "efatura_submissions" ADD CONSTRAINT "efatura_submissions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "efatura_submissions" ADD CONSTRAINT "efatura_submissions_referencesId_fkey" FOREIGN KEY ("referencesId") REFERENCES "efatura_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

