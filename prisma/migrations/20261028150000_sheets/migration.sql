-- Módulo Planilhas (área Administrativo). Migration ADITIVA: só cria enum,
-- tabelas, índices e RLS novos; não altera nada que já existe.
-- CreateEnum
CREATE TYPE "SheetColumnType" AS ENUM ('TEXT', 'LONG_TEXT', 'NUMBER', 'CURRENCY', 'PERCENT', 'DATE', 'CHECKBOX', 'SELECT', 'MULTI_SELECT', 'EMAIL', 'PHONE', 'CPF', 'CNPJ', 'URL', 'USER', 'CONTACT', 'DEAL');

-- CreateTable
CREATE TABLE "Sheet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "updatedById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetColumn" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SheetColumnType" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SheetColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetRow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "position" DOUBLE PRECISION NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SheetRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetRowLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "contactId" TEXT,
    "dealId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SheetRowLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "rowId" TEXT,
    "userId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'app',
    "action" TEXT NOT NULL,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SheetActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sheet_organizationId_archivedAt_idx" ON "Sheet"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "SheetColumn_sheetId_position_idx" ON "SheetColumn"("sheetId", "position");

-- CreateIndex
CREATE INDEX "SheetColumn_organizationId_idx" ON "SheetColumn"("organizationId");

-- CreateIndex
CREATE INDEX "SheetRow_sheetId_deletedAt_position_idx" ON "SheetRow"("sheetId", "deletedAt", "position");

-- CreateIndex
CREATE INDEX "SheetRow_organizationId_idx" ON "SheetRow"("organizationId");

-- CreateIndex
CREATE INDEX "SheetRowLink_organizationId_contactId_idx" ON "SheetRowLink"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "SheetRowLink_organizationId_dealId_idx" ON "SheetRowLink"("organizationId", "dealId");

-- CreateIndex
CREATE UNIQUE INDEX "SheetRowLink_rowId_columnId_key" ON "SheetRowLink"("rowId", "columnId");

-- CreateIndex
CREATE INDEX "SheetActivity_sheetId_createdAt_idx" ON "SheetActivity"("sheetId", "createdAt");

-- CreateIndex
CREATE INDEX "SheetActivity_rowId_createdAt_idx" ON "SheetActivity"("rowId", "createdAt");

-- AddForeignKey
ALTER TABLE "Sheet" ADD CONSTRAINT "Sheet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetColumn" ADD CONSTRAINT "SheetColumn_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetColumn" ADD CONSTRAINT "SheetColumn_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "Sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetRow" ADD CONSTRAINT "SheetRow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetRow" ADD CONSTRAINT "SheetRow_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "Sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetRowLink" ADD CONSTRAINT "SheetRowLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetRowLink" ADD CONSTRAINT "SheetRowLink_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "SheetRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetRowLink" ADD CONSTRAINT "SheetRowLink_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetRowLink" ADD CONSTRAINT "SheetRowLink_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetActivity" ADD CONSTRAINT "SheetActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetActivity" ADD CONSTRAINT "SheetActivity_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "Sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Filtros por valor de célula (values @> '{"<coluna>": ...}') sem varrer a tabela.
CREATE INDEX "SheetRow_values_gin_idx" ON "SheetRow" USING GIN ("values" jsonb_path_ops);

ALTER TABLE "Sheet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Sheet" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Sheet"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "SheetColumn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SheetColumn" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SheetColumn"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "SheetRow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SheetRow" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SheetRow"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "SheetRowLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SheetRowLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SheetRowLink"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "SheetActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SheetActivity" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SheetActivity"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
