-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "gft_inteligente";

-- CreateEnum
CREATE TYPE "gft_inteligente"."UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "gft_inteligente"."CompanyRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "gft_inteligente"."FinanceEntryType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "gft_inteligente"."FinanceCategory" AS ENUM ('SALES', 'SERVICES', 'TAXES', 'RENT', 'PAYROLL', 'UTILITIES', 'MARKETING', 'TRANSPORT', 'SUPPLIERS', 'OTHER');

-- CreateTable
CREATE TABLE "gft_inteligente"."User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "passwordHash" VARCHAR(100) NOT NULL,
    "status" "gft_inteligente"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gft_inteligente"."Company" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gft_inteligente"."CompanyMembership" (
    "userId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "role" "gft_inteligente"."CompanyRole" NOT NULL DEFAULT 'OWNER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyMembership_pkey" PRIMARY KEY ("userId","companyId")
);

-- CreateTable
CREATE TABLE "gft_inteligente"."TermAcceptance" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "termsVersion" VARCHAR(40) NOT NULL,
    "privacyVersion" VARCHAR(40) NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gft_inteligente"."AuditLog" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "companyId" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entityType" VARCHAR(80),
    "entityId" VARCHAR(80),
    "requestId" VARCHAR(100),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gft_inteligente"."FinanceTransaction" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "type" "gft_inteligente"."FinanceEntryType" NOT NULL,
    "category" "gft_inteligente"."FinanceCategory" NOT NULL,
    "description" VARCHAR(160) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FinanceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "gft_inteligente"."User"("email");

-- CreateIndex
CREATE INDEX "User_status_createdAt_idx" ON "gft_inteligente"."User"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyMembership_companyId_role_isActive_idx" ON "gft_inteligente"."CompanyMembership"("companyId", "role", "isActive");

-- CreateIndex
CREATE INDEX "TermAcceptance_companyId_acceptedAt_idx" ON "gft_inteligente"."TermAcceptance"("companyId", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TermAcceptance_userId_companyId_termsVersion_privacyVersion_key" ON "gft_inteligente"."TermAcceptance"("userId", "companyId", "termsVersion", "privacyVersion");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "gft_inteligente"."AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "gft_inteligente"."AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "gft_inteligente"."AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "FinanceTransaction_companyId_occurredAt_idx" ON "gft_inteligente"."FinanceTransaction"("companyId", "occurredAt");

-- CreateIndex
CREATE INDEX "FinanceTransaction_companyId_type_occurredAt_idx" ON "gft_inteligente"."FinanceTransaction"("companyId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "FinanceTransaction_companyId_category_occurredAt_idx" ON "gft_inteligente"."FinanceTransaction"("companyId", "category", "occurredAt");

-- AddForeignKey
ALTER TABLE "gft_inteligente"."CompanyMembership" ADD CONSTRAINT "CompanyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gft_inteligente"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gft_inteligente"."CompanyMembership" ADD CONSTRAINT "CompanyMembership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gft_inteligente"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gft_inteligente"."TermAcceptance" ADD CONSTRAINT "TermAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gft_inteligente"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gft_inteligente"."TermAcceptance" ADD CONSTRAINT "TermAcceptance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gft_inteligente"."Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gft_inteligente"."AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "gft_inteligente"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gft_inteligente"."AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gft_inteligente"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gft_inteligente"."FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gft_inteligente"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gft_inteligente"."FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "gft_inteligente"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Security boundary: GFT data lives in a private schema and is accessed only by server-side Prisma.
REVOKE ALL ON SCHEMA "gft_inteligente" FROM PUBLIC;

DO $gft_schema_acl$
DECLARE
  app_role text;
BEGIN
  FOREACH app_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', 'gft_inteligente', app_role);
    END IF;
  END LOOP;
END
$gft_schema_acl$;

ALTER TABLE "gft_inteligente"."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gft_inteligente"."Company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gft_inteligente"."CompanyMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gft_inteligente"."TermAcceptance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gft_inteligente"."AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gft_inteligente"."FinanceTransaction" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA "gft_inteligente" FROM PUBLIC;

DO $gft_table_acl$
DECLARE
  app_role text;
  table_name text;
BEGIN
  FOREACH app_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
      FOREACH table_name IN ARRAY ARRAY['User', 'Company', 'CompanyMembership', 'TermAcceptance', 'AuditLog', 'FinanceTransaction', '_prisma_migrations'] LOOP
        IF to_regclass(format('%I.%I', 'gft_inteligente', table_name)) IS NOT NULL THEN
          EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM %I', 'gft_inteligente', table_name, app_role);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END
$gft_table_acl$;

-- Defense in depth: persist only positive monetary amounts even if a future client bypasses DTO validation.
ALTER TABLE "gft_inteligente"."FinanceTransaction"
  ADD CONSTRAINT "FinanceTransaction_amount_positive" CHECK ("amount" > 0);
