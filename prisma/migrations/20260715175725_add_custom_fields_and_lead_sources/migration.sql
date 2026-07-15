-- CreateEnum
CREATE TYPE "CustomFieldEntity" AS ENUM ('CONTACT', 'DEAL');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT');

-- AlterEnum
ALTER TYPE "AutomationAction" ADD VALUE 'SET_CUSTOM_FIELD';

-- Os índices trigram (Contact_*_trgm_idx, Deal_name_trgm_idx, criados em
-- 20260714150000_search_trigram_indexes) não são modelados em
-- schema.prisma, então o prisma migrate diff tentou soltá-los aqui por não
-- "enxergar" que existem. Removido de propósito — são geridos só por
-- aquela migration, nunca por esta.

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "customFieldValues" JSONB;

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "customFieldValues" JSONB;

-- CreateTable
CREATE TABLE "LeadSource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldDefinition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" "CustomFieldEntity" NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadSource_organizationId_idx" ON "LeadSource"("organizationId");

-- CreateIndex
CREATE INDEX "CustomFieldDefinition_organizationId_entityType_order_idx" ON "CustomFieldDefinition"("organizationId", "entityType", "order");

-- AddForeignKey
ALTER TABLE "LeadSource" ADD CONSTRAINT "LeadSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (mesmo padrão de Campaign/LossReason/etc. — ver lib/tenant-context.ts)
ALTER TABLE "LeadSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadSource" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeadSource"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "CustomFieldDefinition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomFieldDefinition" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomFieldDefinition"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
