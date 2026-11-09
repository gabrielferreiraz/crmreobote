-- Cadastro do cliente exigido pela administradora antes do Ganho (dados + documentos).
-- Migration aditiva: cria 2 enums, 2 tabelas e 1 coluna com padrão (false) em ConsortiumAdministrator.

CREATE TYPE "DealRegistrationPersonType" AS ENUM ('PF', 'PJ');
CREATE TYPE "DealRegistrationDocKind" AS ENUM ('PHOTO_ID', 'SOCIAL_CONTRACT', 'OTHER');

ALTER TABLE "ConsortiumAdministrator" ADD COLUMN "requiresBankData" BOOLEAN NOT NULL DEFAULT false;
-- A Pontual pede dados bancários para a análise (informado pelo administrativo, 14/08).
UPDATE "ConsortiumAdministrator" SET "requiresBankData" = true WHERE "name" ILIKE '%pontual%';

CREATE TABLE "DealRegistration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "personType" "DealRegistrationPersonType" NOT NULL DEFAULT 'PF',
    "cpf" TEXT,
    "cnpj" TEXT,
    "profession" TEXT,
    "maritalStatus" TEXT,
    "monthlyIncome" DECIMAL(12,2),
    "groupNumber" TEXT,
    "termMonths" INTEGER,
    "paymentMethod" TEXT,
    "bankName" TEXT,
    "bankAgency" TEXT,
    "bankAccount" TEXT,
    "bankAccountType" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "waivedReason" TEXT,
    "waivedAt" TIMESTAMP(3),
    "waivedById" TEXT,
    "quotaRegisteredAt" TIMESTAMP(3),
    "quotaRegisteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealRegistration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DealRegistrationDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "kind" "DealRegistrationDocKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealRegistrationDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DealRegistration_dealId_key" ON "DealRegistration"("dealId");
CREATE INDEX "DealRegistration_organizationId_completedAt_idx" ON "DealRegistration"("organizationId", "completedAt");
CREATE INDEX "DealRegistrationDocument_registrationId_idx" ON "DealRegistrationDocument"("registrationId");

ALTER TABLE "DealRegistration" ADD CONSTRAINT "DealRegistration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DealRegistration" ADD CONSTRAINT "DealRegistration_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DealRegistrationDocument" ADD CONSTRAINT "DealRegistrationDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DealRegistrationDocument" ADD CONSTRAINT "DealRegistrationDocument_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "DealRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealRegistration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DealRegistration" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DealRegistration"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "DealRegistrationDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DealRegistrationDocument" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DealRegistrationDocument"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
