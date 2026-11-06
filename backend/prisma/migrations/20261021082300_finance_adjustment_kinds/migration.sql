CREATE TYPE "gft_inteligente"."FinanceAdjustmentKind" AS ENUM ('VOID', 'REFUND');

ALTER TABLE "gft_inteligente"."FinanceTransaction"
ADD COLUMN "adjustmentKind" "gft_inteligente"."FinanceAdjustmentKind",
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "gft_inteligente"."FinanceTransaction"
SET "adjustmentKind" = 'VOID'
WHERE "reversalOfId" IS NOT NULL AND "adjustmentKind" IS NULL;

ALTER TABLE "gft_inteligente"."FinanceTransaction"
ADD CONSTRAINT "FinanceTransaction_adjustment_link_check"
CHECK (
  ("reversalOfId" IS NULL AND "adjustmentKind" IS NULL)
  OR ("reversalOfId" IS NOT NULL AND "adjustmentKind" IS NOT NULL)
);

CREATE INDEX "FinanceTransaction_companyId_adjustmentKind_occurredAt_idx"
ON "gft_inteligente"."FinanceTransaction"("companyId", "adjustmentKind", "occurredAt");
