-- CreateEnum
CREATE TYPE "gft_inteligente"."RecurrenceFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "gft_inteligente"."FiscalObligationStatus" AS ENUM ('PENDING', 'DONE', 'DISMISSED');

-- AlterTable
ALTER TABLE "gft_inteligente"."FinanceTransaction" ADD COLUMN     "recurrenceId" UUID;

-- CreateTable
CREATE TABLE "gft_inteligente"."PasswordResetToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(100) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gft_inteligente"."FiscalObligation" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(400),
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "gft_inteligente"."FiscalObligationStatus" NOT NULL DEFAULT 'PENDING',
    "source" VARCHAR(40) NOT NULL,
    "periodKey" VARCHAR(20),
    "completedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FiscalObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gft_inteligente"."FinanceRecurrence" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "type" "FinanceEntryType" NOT NULL,
    "category" "FinanceCategory" NOT NULL,
    "subcategory" VARCHAR(80),
    "description" VARCHAR(160) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "counterpartyId" UUID,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMPTZ(3) NOT NULL,
    "endDate" TIMESTAMPTZ(3),
    "nextRunAt" TIMESTAMPTZ(3) NOT NULL,
    "lastRunAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FinanceRecurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gft_inteligente"."FinanceAttachment" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "uploadedByUserId" UUID NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "contentType" VARCHAR(120) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "storageKey" VARCHAR(300) NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "gft_inteligente"."PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "gft_inteligente"."PasswordResetToken"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "FiscalObligation_companyId_dueAt_idx" ON "gft_inteligente"."FiscalObligation"("companyId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalObligation_companyId_kind_periodKey_key" ON "gft_inteligente"."FiscalObligation"("companyId", "kind", "periodKey");

-- CreateIndex
CREATE INDEX "FinanceRecurrence_companyId_isActive_nextRunAt_idx" ON "gft_inteligente"."FinanceRecurrence"("companyId", "isActive", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceRecurrence_id_companyId_key" ON "gft_inteligente"."FinanceRecurrence"("id", "companyId");

-- CreateIndex
CREATE INDEX "FinanceAttachment_companyId_transactionId_idx" ON "gft_inteligente"."FinanceAttachment"("companyId", "transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceAttachment_id_companyId_key" ON "gft_inteligente"."FinanceAttachment"("id", "companyId");

-- CreateIndex
CREATE INDEX "FinanceTransaction_companyId_recurrenceId_idx" ON "gft_inteligente"."FinanceTransaction"("companyId", "recurrenceId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceTransaction_id_companyId_key" ON "gft_inteligente"."FinanceTransaction"("id", "companyId");

-- AddForeignKey
ALTER TABLE "gft_inteligente"."PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gft_inteligente"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gft_inteligente"."FiscalObligation" ADD CONSTRAINT "FiscalObligation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gft_inteligente"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gft_inteligente"."FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_recurrenceId_companyId_fkey" FOREIGN KEY ("recurrenceId", "companyId") REFERENCES "gft_inteligente"."FinanceRecurrence"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gft_inteligente"."FinanceRecurrence" ADD CONSTRAINT "FinanceRecurrence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gft_inteligente"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gft_inteligente"."FinanceRecurrence" ADD CONSTRAINT "FinanceRecurrence_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "gft_inteligente"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gft_inteligente"."FinanceRecurrence" ADD CONSTRAINT "FinanceRecurrence_counterpartyId_companyId_fkey" FOREIGN KEY ("counterpartyId", "companyId") REFERENCES "gft_inteligente"."FinanceCounterparty"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gft_inteligente"."FinanceAttachment" ADD CONSTRAINT "FinanceAttachment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gft_inteligente"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gft_inteligente"."FinanceAttachment" ADD CONSTRAINT "FinanceAttachment_transactionId_companyId_fkey" FOREIGN KEY ("transactionId", "companyId") REFERENCES "gft_inteligente"."FinanceTransaction"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gft_inteligente"."FinanceAttachment" ADD CONSTRAINT "FinanceAttachment_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "gft_inteligente"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- RLS habilitada; policies de tenant ficam em migration separada.
ALTER TABLE "gft_inteligente"."PasswordResetToken" ENABLE ROW LEVEL SECURITY;

-- RLS habilitada; policies de tenant ficam em migration separada.
ALTER TABLE "gft_inteligente"."FiscalObligation" ENABLE ROW LEVEL SECURITY;

-- RLS habilitada; policies de tenant ficam em migration separada.
ALTER TABLE "gft_inteligente"."FinanceRecurrence" ENABLE ROW LEVEL SECURITY;

-- RLS habilitada; policies de tenant ficam em migration separada.
ALTER TABLE "gft_inteligente"."FinanceAttachment" ENABLE ROW LEVEL SECURITY;
