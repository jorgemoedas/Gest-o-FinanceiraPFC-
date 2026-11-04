-- Sessões opacas de renovação; somente hashes SHA-256 são persistidos.
CREATE TABLE gft_inteligente."RefreshSessionToken" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tokenHash" char(64) NOT NULL UNIQUE,
  "familyId" uuid NOT NULL,
  "userId" uuid NOT NULL REFERENCES gft_inteligente."User"(id) ON DELETE CASCADE,
  "companyId" uuid NOT NULL REFERENCES gft_inteligente."Company"(id) ON DELETE CASCADE,
  "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
  "expiresAt" timestamptz(3) NOT NULL,
  "consumedAt" timestamptz(3),
  "revokedAt" timestamptz(3)
);
CREATE INDEX "RefreshSessionToken_family_idx" ON gft_inteligente."RefreshSessionToken"("familyId");
CREATE INDEX "RefreshSessionToken_user_company_expiry_idx" ON gft_inteligente."RefreshSessionToken"("userId", "companyId", "expiresAt");
ALTER TABLE gft_inteligente."RefreshSessionToken" ENABLE ROW LEVEL SECURITY;
CREATE POLICY refresh_session_tenant ON gft_inteligente."RefreshSessionToken"
  FOR ALL USING ("userId" = gft_inteligente.current_actor_id() AND "companyId" = gft_inteligente.current_company_id())
  WITH CHECK ("userId" = gft_inteligente.current_actor_id() AND "companyId" = gft_inteligente.current_company_id());
REVOKE ALL ON TABLE gft_inteligente."RefreshSessionToken" FROM PUBLIC;
GRANT INSERT ON TABLE gft_inteligente."RefreshSessionToken" TO gft_app;

-- Uma única operação serializa concorrência por token e invalida a família se
-- uma credencial consumida for reapresentada.
CREATE OR REPLACE FUNCTION gft_inteligente.auth_consume_refresh_token(p_hash text)
RETURNS TABLE (result_status text, user_id uuid, company_id uuid, family_id uuid, email text, role text, company_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = gft_inteligente, pg_temp AS $$
DECLARE t gft_inteligente."RefreshSessionToken"%ROWTYPE; v_email text; v_role text; v_company_name text; v_status text;
BEGIN
  SELECT * INTO t FROM gft_inteligente."RefreshSessionToken" WHERE "tokenHash" = p_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'MISSING'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text; RETURN; END IF;
  IF t."consumedAt" IS NOT NULL THEN
    UPDATE gft_inteligente."RefreshSessionToken" SET "revokedAt" = COALESCE("revokedAt", now()) WHERE "familyId" = t."familyId";
    RETURN QUERY SELECT 'REUSED'::text, t."userId", t."companyId", t."familyId", NULL::text, NULL::text, NULL::text; RETURN;
  END IF;
  IF t."revokedAt" IS NOT NULL THEN RETURN QUERY SELECT 'REVOKED'::text, t."userId", t."companyId", t."familyId", NULL::text, NULL::text, NULL::text; RETURN; END IF;
  IF t."expiresAt" <= now() THEN
    UPDATE gft_inteligente."RefreshSessionToken" SET "revokedAt" = now() WHERE id = t.id;
    RETURN QUERY SELECT 'EXPIRED'::text, t."userId", t."companyId", t."familyId", NULL::text, NULL::text, NULL::text; RETURN;
  END IF;
  SELECT CASE WHEN u.status::text = 'ACTIVE' AND m."isActive" THEN 'ACTIVE' ELSE 'INACTIVE' END,
    u.email, m.role::text, c.name INTO v_status, v_email, v_role, v_company_name
  FROM gft_inteligente."User" u
  JOIN gft_inteligente."CompanyMembership" m ON m."userId"=u.id AND m."companyId"=t."companyId"
  JOIN gft_inteligente."Company" c ON c.id=t."companyId" WHERE u.id=t."userId";
  IF NOT FOUND THEN
    UPDATE gft_inteligente."RefreshSessionToken" SET "revokedAt"=now() WHERE "familyId"=t."familyId";
    RETURN QUERY SELECT 'INACTIVE'::text, t."userId", t."companyId", t."familyId", NULL::text, NULL::text, NULL::text; RETURN;
  END IF;
  IF v_status = 'INACTIVE' THEN
    UPDATE gft_inteligente."RefreshSessionToken" SET "revokedAt"=now() WHERE "familyId"=t."familyId";
    RETURN QUERY SELECT v_status, t."userId", t."companyId", t."familyId", v_email, v_role, v_company_name; RETURN;
  END IF;
  RETURN QUERY SELECT v_status, t."userId", t."companyId", t."familyId", v_email, v_role, v_company_name;
  UPDATE gft_inteligente."RefreshSessionToken" SET "consumedAt" = now() WHERE id = t.id;
END $$;

CREATE OR REPLACE FUNCTION gft_inteligente.auth_revoke_refresh_family(p_hash text)
RETURNS TABLE (user_id uuid, company_id uuid, family_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = gft_inteligente, pg_temp AS $$
DECLARE t gft_inteligente."RefreshSessionToken"%ROWTYPE;
BEGIN
  SELECT * INTO t FROM gft_inteligente."RefreshSessionToken" WHERE "tokenHash"=p_hash AND "revokedAt" IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE gft_inteligente."RefreshSessionToken" SET "revokedAt"=now() WHERE "familyId"=t."familyId";
  RETURN QUERY SELECT t."userId", t."companyId", t."familyId";
END $$;
REVOKE ALL ON FUNCTION gft_inteligente.auth_consume_refresh_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION gft_inteligente.auth_revoke_refresh_family(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gft_inteligente.auth_consume_refresh_token(text) TO gft_app;
GRANT EXECUTE ON FUNCTION gft_inteligente.auth_revoke_refresh_family(text) TO gft_app;
