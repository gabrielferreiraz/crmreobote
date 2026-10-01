-- Progresso do curso da Reobote Academy (sistema externo, sem banco próprio
-- — ver Progresso no schema e lib/academy-auth.ts). Escrita à mão (não
-- gerada por `prisma migrate dev`): a shadow database do migrate dev falha
-- numa migração ANTERIOR e não relacionada (20260812090000_tv_dashboard_
-- config_rls), então toda migração nova neste repo é escrita e aplicada
-- manualmente — mesma observação das migrations anteriores.

-- CreateTable
CREATE TABLE "Progresso" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "aulaId" TEXT NOT NULL,
    "concluidaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Progresso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Progresso_organizationId_userId_aulaId_key" ON "Progresso"("organizationId", "userId", "aulaId");

-- CreateIndex
CREATE INDEX "Progresso_organizationId_userId_idx" ON "Progresso"("organizationId", "userId");

-- AddForeignKey
ALTER TABLE "Progresso" ADD CONSTRAINT "Progresso_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Progresso" ADD CONSTRAINT "Progresso_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: toda tabela com organizationId precisa disso (Prisma não modela RLS,
-- ver migrations anteriores pro mesmo padrão) — sem isso a tabela fica sem
-- isolamento no nível do banco, só o `where: organizationId` do código (e as
-- rotas da Academy são a integração machine-to-machine mais nova do sistema
-- — a última coisa que se quer é essa ser a única tabela sem a 2ª camada de
-- proteção).
ALTER TABLE "Progresso" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Progresso" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Progresso"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
