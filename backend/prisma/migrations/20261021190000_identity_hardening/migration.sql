-- Endurecimento das tabelas de identidade e das consultas pré-autenticação.
--
-- A migration anterior deixou as cinco tabelas de identidade com política
-- permissiva porque o login resolve a conta pelo e-mail antes de existir
-- empresa no contexto. Aqui essa exceção é substituída por funções
-- SECURITY DEFINER de escopo estreito, e as políticas passam a exigir o ator
-- ou a empresa da transação.

-- A conexão administrativa assume o papel restrito dentro de cada transação.
-- Sem esta associação o SET LOCAL ROLE seria recusado e o RLS não valeria
-- para a aplicação.
GRANT gft_app TO postgres;

-- Resolve a conta pelo e-mail para cadastro, login e redefinição de senha.
CREATE OR REPLACE FUNCTION gft_inteligente.auth_user_by_email(p_email text)
RETURNS TABLE (id uuid, email text, password_hash text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = gft_inteligente, pg_temp
AS $$
  SELECT u.id, u.email, u."passwordHash", u.status::text
  FROM gft_inteligente."User" u
  WHERE u.email = p_email
  LIMIT 1
$$;

-- Primeira associação ativa do usuário, com o nome da empresa para o token.
CREATE OR REPLACE FUNCTION gft_inteligente.auth_active_membership(p_user_id uuid)
RETURNS TABLE (company_id uuid, role text, company_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = gft_inteligente, pg_temp
AS $$
  SELECT m."companyId", m.role::text, c.name
  FROM gft_inteligente."CompanyMembership" m
  JOIN gft_inteligente."Company" c ON c.id = m."companyId"
  WHERE m."userId" = p_user_id AND m."isActive" = true
  ORDER BY m."createdAt" ASC
  LIMIT 1
$$;

-- Recupera o token de redefinição pelo hash, sem exigir contexto prévio.
CREATE OR REPLACE FUNCTION gft_inteligente.auth_reset_token_by_hash(p_token_hash text)
RETURNS TABLE (id uuid, user_id uuid, used_at timestamptz, expires_at timestamptz, user_email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = gft_inteligente, pg_temp
AS $$
  SELECT t.id, t."userId", t."usedAt", t."expiresAt", u.email
  FROM gft_inteligente."PasswordResetToken" t
  JOIN gft_inteligente."User" u ON u.id = t."userId"
  WHERE t."tokenHash" = p_token_hash
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION gft_inteligente.auth_user_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION gft_inteligente.auth_active_membership(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION gft_inteligente.auth_reset_token_by_hash(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION gft_inteligente.auth_user_by_email(text) TO gft_app;
GRANT EXECUTE ON FUNCTION gft_inteligente.auth_active_membership(uuid) TO gft_app;
GRANT EXECUTE ON FUNCTION gft_inteligente.auth_reset_token_by_hash(text) TO gft_app;

DROP POLICY authentication_flow ON gft_inteligente."User";
DROP POLICY authentication_flow ON gft_inteligente."Company";
DROP POLICY authentication_flow ON gft_inteligente."CompanyMembership";
DROP POLICY authentication_flow ON gft_inteligente."TermAcceptance";
DROP POLICY authentication_flow ON gft_inteligente."PasswordResetToken";

-- User: cada sessão enxerga e altera apenas a própria linha.
CREATE POLICY actor_row ON gft_inteligente."User"
  FOR SELECT USING (id = gft_inteligente.current_actor_id());
CREATE POLICY actor_insert ON gft_inteligente."User"
  FOR INSERT WITH CHECK (id = gft_inteligente.current_actor_id());
CREATE POLICY actor_update ON gft_inteligente."User"
  FOR UPDATE USING (id = gft_inteligente.current_actor_id())
  WITH CHECK (id = gft_inteligente.current_actor_id());

-- Company: a empresa da transação e nada além dela.
CREATE POLICY company_row ON gft_inteligente."Company"
  FOR SELECT USING (id = gft_inteligente.current_company_id());
CREATE POLICY company_insert ON gft_inteligente."Company"
  FOR INSERT WITH CHECK (id = gft_inteligente.current_company_id());
CREATE POLICY company_update ON gft_inteligente."Company"
  FOR UPDATE USING (id = gft_inteligente.current_company_id())
  WITH CHECK (id = gft_inteligente.current_company_id());

-- CompanyMembership: precisa da empresa e do ator ao mesmo tempo.
CREATE POLICY membership_row ON gft_inteligente."CompanyMembership"
  FOR SELECT USING (
    "companyId" = gft_inteligente.current_company_id()
    AND "userId" = gft_inteligente.current_actor_id()
  );
CREATE POLICY membership_insert ON gft_inteligente."CompanyMembership"
  FOR INSERT WITH CHECK (
    "companyId" = gft_inteligente.current_company_id()
    AND "userId" = gft_inteligente.current_actor_id()
  );
CREATE POLICY membership_update ON gft_inteligente."CompanyMembership"
  FOR UPDATE USING (
    "companyId" = gft_inteligente.current_company_id()
    AND "userId" = gft_inteligente.current_actor_id()
  )
  WITH CHECK (
    "companyId" = gft_inteligente.current_company_id()
    AND "userId" = gft_inteligente.current_actor_id()
  );
CREATE POLICY membership_delete ON gft_inteligente."CompanyMembership"
  FOR DELETE USING (
    "companyId" = gft_inteligente.current_company_id()
    AND "userId" = gft_inteligente.current_actor_id()
  );

-- TermAcceptance: consentimento lido e gravado apenas pelo próprio titular.
CREATE POLICY acceptance_row ON gft_inteligente."TermAcceptance"
  FOR SELECT USING (
    "companyId" = gft_inteligente.current_company_id()
    AND "userId" = gft_inteligente.current_actor_id()
  );
CREATE POLICY acceptance_insert ON gft_inteligente."TermAcceptance"
  FOR INSERT WITH CHECK (
    "companyId" = gft_inteligente.current_company_id()
    AND "userId" = gft_inteligente.current_actor_id()
  );

-- PasswordResetToken: somente o titular do token. O resgate pelo hash passa
-- pela função SECURITY DEFINER acima.
CREATE POLICY token_row ON gft_inteligente."PasswordResetToken"
  FOR SELECT USING ("userId" = gft_inteligente.current_actor_id());
CREATE POLICY token_insert ON gft_inteligente."PasswordResetToken"
  FOR INSERT WITH CHECK ("userId" = gft_inteligente.current_actor_id());
CREATE POLICY token_update ON gft_inteligente."PasswordResetToken"
  FOR UPDATE USING ("userId" = gft_inteligente.current_actor_id())
  WITH CHECK ("userId" = gft_inteligente.current_actor_id());