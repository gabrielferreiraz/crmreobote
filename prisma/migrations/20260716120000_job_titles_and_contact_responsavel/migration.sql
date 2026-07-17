-- CreateTable
CREATE TABLE "JobTitle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobTitle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobTitle_organizationId_idx" ON "JobTitle"("organizationId");

-- AddForeignKey
ALTER TABLE "JobTitle" ADD CONSTRAINT "JobTitle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (mesmo padrão de LeadSource/CreditType — ver lib/tenant-context.ts)
ALTER TABLE "JobTitle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobTitle" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "JobTitle"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

-- Backfill: preserva as 12 opções hoje fixas em lib/job-titles.ts pra toda
-- organização já existente, agora editáveis em Configurações → Cargos.
INSERT INTO "JobTitle" ("id", "organizationId", "label", "order", "createdAt")
SELECT
  'jt_' || substr(md5(random()::text || clock_timestamp()::text || o."id" || t.label), 1, 20),
  o."id",
  t.label,
  t.ord,
  now()
FROM "Organization" o
CROSS JOIN (VALUES
  ('Médico(a)', 0),
  ('Advogado(a)', 1),
  ('Empresário(a)', 2),
  ('Pessoa Física', 3),
  ('Dentista', 4),
  ('Engenheiro(a)', 5),
  ('Contador(a)', 6),
  ('Servidor(a) Público(a)', 7),
  ('Autônomo(a)', 8),
  ('Produtor(a) Rural', 9),
  ('Aposentado(a)', 10),
  ('Outro', 11)
) AS t(label, ord);

-- AlterTable: responsável do cliente (informativo/atribuível — não restringe
-- quem pode ver o contato, Contact continua compartilhado pela organização).
ALTER TABLE "Contact" ADD COLUMN "responsavelId" TEXT;

-- CreateIndex
CREATE INDEX "Contact_organizationId_responsavelId_idx" ON "Contact"("organizationId", "responsavelId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
