CREATE TYPE "gft_inteligente"."CounterpartyRole" AS ENUM ('CUSTOMER', 'SUPPLIER', 'BOTH');

ALTER TABLE "gft_inteligente"."FinanceTransaction"
  ADD COLUMN "counterpartyId" UUID;

CREATE TABLE "gft_inteligente"."FinanceCounterparty" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "role" "gft_inteligente"."CounterpartyRole" NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "FinanceCounterparty_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FinanceCounterparty_companyId_role_name_idx"
  ON "gft_inteligente"."FinanceCounterparty"("companyId", "role", "name");

CREATE UNIQUE INDEX "FinanceCounterparty_id_companyId_key"
  ON "gft_inteligente"."FinanceCounterparty"("id", "companyId");

CREATE INDEX "FinanceTransaction_companyId_counterpartyId_idx"
  ON "gft_inteligente"."FinanceTransaction"("companyId", "counterpartyId");

ALTER TABLE "gft_inteligente"."FinanceCounterparty"
  ADD CONSTRAINT "FinanceCounterparty_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "gft_inteligente"."Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gft_inteligente"."FinanceTransaction"
  ADD CONSTRAINT "FinanceTransaction_counterpartyId_companyId_fkey"
  FOREIGN KEY ("counterpartyId", "companyId")
  REFERENCES "gft_inteligente"."FinanceCounterparty"("id", "companyId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gft_inteligente"."FinanceCounterparty" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "gft_inteligente"."FinanceCounterparty" FROM PUBLIC;

DO $counterparty_acl$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE %I.%I FROM %I',
        'gft_inteligente',
        'FinanceCounterparty',
        role_name
      );
    END IF;
  END LOOP;
END
$counterparty_acl$;
