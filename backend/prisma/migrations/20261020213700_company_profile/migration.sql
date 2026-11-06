-- CreateTable
CREATE TABLE "gft_inteligente"."CompanyProfile" (
    "companyId" UUID NOT NULL,
    "cnpj" VARCHAR(14) NOT NULL,
    "legalName" VARCHAR(200) NOT NULL,
    "tradeName" VARCHAR(200),
    "registrationStatus" VARCHAR(40),
    "companyType" VARCHAR(40),
    "size" VARCHAR(40),
    "openingDate" VARCHAR(10),
    "mainActivityCode" VARCHAR(32),
    "mainActivityDescription" VARCHAR(200),
    "street" VARCHAR(160),
    "number" VARCHAR(40),
    "complement" VARCHAR(80),
    "district" VARCHAR(100),
    "city" VARCHAR(100),
    "state" VARCHAR(2),
    "postalCode" VARCHAR(8),
    "source" VARCHAR(32) NOT NULL DEFAULT 'ReceitaWS',
    "consultedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("companyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyProfile_cnpj_key" ON "gft_inteligente"."CompanyProfile"("cnpj");

-- AddForeignKey
ALTER TABLE "gft_inteligente"."CompanyProfile" ADD CONSTRAINT "CompanyProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gft_inteligente"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
