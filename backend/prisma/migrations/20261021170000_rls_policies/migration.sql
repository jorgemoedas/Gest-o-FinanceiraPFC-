-- Políticas de Row Level Security para isolamento por empresa.
--
-- O contexto é definido por transação em `setTenantContext`, que grava
-- `gft.company_id` e `gft.user_id` com `set_config(..., is_local => true)`.
-- As funções abaixo devolvem NULL quando a variável não existe ou não é um
-- UUID, o que faz a política negar acesso em vez de falhar a consulta.

CREATE OR REPLACE FUNCTION gft_inteligente.current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN current_setting('gft.company_id', true) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN current_setting('gft.company_id', true)::uuid
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION gft_inteligente.current_actor_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN current_setting('gft.user_id', true) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN current_setting('gft.user_id', true)::uuid
    ELSE NULL
  END
$$;

-- Dados de negócio: acesso restrito à empresa da transação corrente.

CREATE POLICY company_isolation ON gft_inteligente."FinanceTransaction"
  FOR ALL
  USING ("companyId" = gft_inteligente.current_company_id())
  WITH CHECK ("companyId" = gft_inteligente.current_company_id());

CREATE POLICY company_isolation ON gft_inteligente."FinanceCounterparty"
  FOR ALL
  USING ("companyId" = gft_inteligente.current_company_id())
  WITH CHECK ("companyId" = gft_inteligente.current_company_id());

CREATE POLICY company_isolation ON gft_inteligente."FinanceRecurrence"
  FOR ALL
  USING ("companyId" = gft_inteligente.current_company_id())
  WITH CHECK ("companyId" = gft_inteligente.current_company_id());

CREATE POLICY company_isolation ON gft_inteligente."FinanceAttachment"
  FOR ALL
  USING ("companyId" = gft_inteligente.current_company_id())
  WITH CHECK ("companyId" = gft_inteligente.current_company_id());

CREATE POLICY company_isolation ON gft_inteligente."FiscalObligation"
  FOR ALL
  USING ("companyId" = gft_inteligente.current_company_id())
  WITH CHECK ("companyId" = gft_inteligente.current_company_id());

CREATE POLICY company_isolation ON gft_inteligente."CompanyProfile"
  FOR ALL
  USING ("companyId" = gft_inteligente.current_company_id())
  WITH CHECK ("companyId" = gft_inteligente.current_company_id());

-- Auditoria: a empresa é o escopo normal; eventos de autenticação sem empresa,
-- como tentativas de login malsucedidas, ficam restritos ao próprio ator.

CREATE POLICY company_isolation ON gft_inteligente."AuditLog"
  FOR ALL
  USING (
    "companyId" = gft_inteligente.current_company_id()
    OR ("companyId" IS NULL AND "actorUserId" = gft_inteligente.current_actor_id())
  )
  WITH CHECK (
    "companyId" = gft_inteligente.current_company_id()
    OR ("companyId" IS NULL AND "actorUserId" = gft_inteligente.current_actor_id())
  );

-- Tabelas de identidade e consentimento: o tenant ainda não é conhecido no
-- momento da autenticação, porque o login resolve a conta pelo e-mail antes de
-- existir contexto de empresa. A política é permissiva de forma deliberada e o
-- controle permanece nos privilégios concedidos ao papel de execução e nas
-- regras da aplicação. A alternativa, que exige função SECURITY DEFINER para a
-- consulta pré-autenticação, está registrada como evolução pendente.

CREATE POLICY authentication_flow ON gft_inteligente."User"
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY authentication_flow ON gft_inteligente."Company"
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY authentication_flow ON gft_inteligente."CompanyMembership"
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY authentication_flow ON gft_inteligente."TermAcceptance"
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY authentication_flow ON gft_inteligente."PasswordResetToken"
  FOR ALL USING (true) WITH CHECK (true);

-- O dono da tabela deixa de ignorar as políticas. Papéis com BYPASSRLS, como o
-- usado durante as migrations, continuam isentos, o que mantém as migrações
-- funcionando sem depender de contexto de tenant.

ALTER TABLE gft_inteligente."FinanceTransaction" FORCE ROW LEVEL SECURITY;
ALTER TABLE gft_inteligente."FinanceCounterparty" FORCE ROW LEVEL SECURITY;
ALTER TABLE gft_inteligente."FinanceRecurrence" FORCE ROW LEVEL SECURITY;
ALTER TABLE gft_inteligente."FinanceAttachment" FORCE ROW LEVEL SECURITY;
ALTER TABLE gft_inteligente."FiscalObligation" FORCE ROW LEVEL SECURITY;
ALTER TABLE gft_inteligente."CompanyProfile" FORCE ROW LEVEL SECURITY;
ALTER TABLE gft_inteligente."AuditLog" FORCE ROW LEVEL SECURITY;