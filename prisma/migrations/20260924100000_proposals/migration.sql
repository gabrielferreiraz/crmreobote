-- Propostas comerciais estruturadas (ver comentário completo no model
-- Proposal, schema.prisma) — substitui a antiga "Proposta" de nota livre
-- (ActivityType/TaskType.PROPOSAL, que continuam existindo só pelo
-- histórico, nunca mais criados pela UI a partir daqui).

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'GENERATED', 'SENT', 'ACCEPTED', 'DECLINED', 'SUPERSEDED', 'CANCELLED');

-- AlterTable: modelo padrão de descrição da proposta (Dono, Configurações)
ALTER TABLE "Organization" ADD COLUMN "defaultProposalDescription" TEXT;

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "revision" INTEGER NOT NULL,
    "parentId" TEXT,
    "createdById" TEXT NOT NULL,
    "sentById" TEXT,
    "credit" DECIMAL(12,2) NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "installment" DECIMAL(12,2) NOT NULL,
    "quotaCount" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "generatedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_number_key" ON "Proposal"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_dealId_revision_key" ON "Proposal"("dealId", "revision");

-- CreateIndex
CREATE INDEX "Proposal_organizationId_idx" ON "Proposal"("organizationId");

-- CreateIndex
CREATE INDEX "Proposal_dealId_idx" ON "Proposal"("dealId");

-- CreateIndex
CREATE INDEX "Proposal_sentById_sentAt_idx" ON "Proposal"("sentById", "sentAt");

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: mesma policy padrão org-scoped do projeto (Proposal nunca é
-- acessada por rota pública/bootstrap nenhuma — só de dentro do CRM
-- autenticado, então não precisa da variante de bootstrap por slug/token
-- que outras tabelas têm).
ALTER TABLE "Proposal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Proposal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Proposal"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
