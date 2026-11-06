CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX "FinanceCounterparty_name_trgm_idx"
  ON "gft_inteligente"."FinanceCounterparty"
  USING GIN ("name" extensions.gin_trgm_ops);
