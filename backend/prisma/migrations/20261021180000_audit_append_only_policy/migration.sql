-- A trilha de auditoria é escrita pelo servidor em fluxos que ainda não têm
-- contexto de empresa, como o cadastro, o login e a solicitação de redefinição
-- de senha. A política passa a separar as operações: escrita liberada para o
-- servidor, leitura restrita à empresa da transação e atualização ou exclusão
-- sem política alguma, o que as nega por padrão e torna a trilha somente
-- acrescentável.

DROP POLICY IF EXISTS company_isolation ON gft_inteligente."AuditLog";

CREATE POLICY audit_append ON gft_inteligente."AuditLog"
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY audit_read ON gft_inteligente."AuditLog"
  FOR SELECT
  USING (
    "companyId" = gft_inteligente.current_company_id()
    OR ("companyId" IS NULL AND "actorUserId" = gft_inteligente.current_actor_id())
  );