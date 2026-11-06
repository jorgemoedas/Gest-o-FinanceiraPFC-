-- Índices de leitura para os caminhos de dashboard, analítico e lançamentos recentes.
-- Os índices parciais seguem exatamente os predicados das consultas e evitam
-- carregar no índice linhas CANCELLED/REVERSED ou ajustes VOID.

CREATE INDEX "FinanceTransaction_companyId_paid_occurredAt_read_idx"
  ON "gft_inteligente"."FinanceTransaction" ("companyId", "occurredAt")
  INCLUDE ("type", "category", "amount")
  WHERE "status" = 'PAID'
    AND ("adjustmentKind" IS NULL OR "adjustmentKind" = 'REFUND');

CREATE INDEX "FinanceTransaction_companyId_pending_dueAt_read_idx"
  ON "gft_inteligente"."FinanceTransaction" ("companyId", "dueAt")
  INCLUDE ("type", "amount")
  WHERE "status" = 'PENDING'
    AND "reversalOfId" IS NULL
    AND "adjustmentKind" IS NULL;

CREATE INDEX "FinanceTransaction_companyId_occurredAt_createdAt_idx"
  ON "gft_inteligente"."FinanceTransaction" ("companyId", "occurredAt" DESC, "createdAt" DESC);

CREATE INDEX "FinanceTransaction_companyId_status_occurredAt_idx"
  ON "gft_inteligente"."FinanceTransaction" ("companyId", "status", "occurredAt");
