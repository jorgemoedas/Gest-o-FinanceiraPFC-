ALTER TABLE "gft_inteligente"."FinanceCounterparty"
  ADD COLUMN "cnpj" VARCHAR(14),
  ADD COLUMN "legalName" VARCHAR(200),
  ADD COLUMN "tradeName" VARCHAR(200),
  ADD COLUMN "source" VARCHAR(32),
  ADD COLUMN "consultedAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "FinanceCounterparty_companyId_cnpj_key"
  ON "gft_inteligente"."FinanceCounterparty"("companyId", "cnpj");
