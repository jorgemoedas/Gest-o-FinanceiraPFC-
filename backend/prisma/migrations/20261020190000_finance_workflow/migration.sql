CREATE TYPE "gft_inteligente"."FinanceTransactionStatus" AS ENUM ('PAID', 'PENDING', 'CANCELLED', 'REVERSED');

ALTER TABLE "gft_inteligente"."FinanceTransaction"
  ADD COLUMN "subcategory" VARCHAR(80),
  ADD COLUMN "dueAt" TIMESTAMPTZ(3),
  ADD COLUMN "status" "gft_inteligente"."FinanceTransactionStatus" NOT NULL DEFAULT 'PAID',
  ADD COLUMN "reversalOfId" UUID,
  ADD COLUMN "reversedAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "FinanceTransaction_reversalOfId_key"
  ON "gft_inteligente"."FinanceTransaction"("reversalOfId");

CREATE INDEX "FinanceTransaction_companyId_status_dueAt_idx"
  ON "gft_inteligente"."FinanceTransaction"("companyId", "status", "dueAt");

ALTER TABLE "gft_inteligente"."FinanceTransaction"
  ADD CONSTRAINT "FinanceTransaction_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId")
  REFERENCES "gft_inteligente"."FinanceTransaction"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
