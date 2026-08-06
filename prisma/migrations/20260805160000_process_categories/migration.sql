-- Categoria de processo (ex.: "Imóvel", "Automóvel") — nível novo ACIMA de
-- ProcessPipeline (que na prática vira a "Subcategoria" da UI: Imóvel →
-- Aquisição/Construção/Transferência, cada uma com etapas próprias).
CREATE TABLE "ProcessCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessCategory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProcessCategory_organizationId_idx" ON "ProcessCategory"("organizationId");

ALTER TABLE "ProcessCategory" ADD CONSTRAINT "ProcessCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: mesmo padrão tenant_isolation usado em toda tabela com organizationId próprio.
ALTER TABLE "ProcessCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProcessCategory" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProcessCategory"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

-- Backfill: uma categoria "Geral" por organização que já tenha
-- ProcessPipeline — o administrativo reorganiza depois (renomeia "Geral"
-- pra "Imóvel", cria "Automóvel", move subcategorias) pelas telas novas.
-- Nenhum Process/ProcessStage existente é tocado, só ganham um nível de
-- categoria em cima.
INSERT INTO "ProcessCategory" ("id", "organizationId", "name", "order", "createdAt")
SELECT
  'pcat_' || substr(md5(random()::text || clock_timestamp()::text || o."id"), 1, 20),
  o."id",
  'Geral',
  0,
  now()
FROM (SELECT DISTINCT "organizationId" AS "id" FROM "ProcessPipeline") o;

-- AlterTable: ProcessPipeline passa a pertencer a uma categoria.
ALTER TABLE "ProcessPipeline" ADD COLUMN "categoryId" TEXT;

UPDATE "ProcessPipeline" p
SET "categoryId" = c."id"
FROM "ProcessCategory" c
WHERE c."organizationId" = p."organizationId" AND c."name" = 'Geral';

ALTER TABLE "ProcessPipeline" ALTER COLUMN "categoryId" SET NOT NULL;

CREATE INDEX "ProcessPipeline_categoryId_idx" ON "ProcessPipeline"("categoryId");

ALTER TABLE "ProcessPipeline" ADD CONSTRAINT "ProcessPipeline_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProcessCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
