-- Escrita à mão (não gerada por `prisma migrate dev`) — a shadow database
-- usada pra gerar migração automaticamente já falha numa migração ANTERIOR
-- e não relacionada (20260812090000_tv_dashboard_config_rls, ver comentário
-- lá). Mesma sintaxe exata de "resolvedById" (relação opcional pra User já
-- existente nesta mesma tabela, ver 20260911120000_lead_requests) aplicada
-- em "assigneeId" — pra quem vai o lead se o pedido for aprovado, quando é
-- alguém diferente de quem pediu (ver comentário completo em
-- prisma/schema.prisma).
ALTER TABLE "LeadRequest" ADD COLUMN "assigneeId" TEXT;

-- AddForeignKey
ALTER TABLE "LeadRequest" ADD CONSTRAINT "LeadRequest_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
