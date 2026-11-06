ALTER TABLE "gft_inteligente"."CompanyProfile"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "gft_inteligente"."CompanyProfile"
  ALTER COLUMN "createdAt" DROP DEFAULT;

ALTER TABLE "gft_inteligente"."CompanyProfile"
  ALTER COLUMN "consultedAt" TYPE TIMESTAMPTZ(3)
    USING "consultedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3)
    USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3)
    USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "gft_inteligente"."CompanyProfile"
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "gft_inteligente"."CompanyProfile" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "gft_inteligente"."CompanyProfile" FROM PUBLIC;

DO $profile_acl$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE %I.%I FROM %I',
        'gft_inteligente',
        'CompanyProfile',
        role_name
      );
    END IF;
  END LOOP;
END
$profile_acl$;
