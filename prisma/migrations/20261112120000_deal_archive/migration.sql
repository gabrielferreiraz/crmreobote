-- Arquivar negócio: tira do Kanban e das listagens sem apagar nada
-- (reversível pela lista de arquivados). Migration ADITIVA: duas colunas
-- opcionais e um índice. Nenhuma linha existente muda — negócio que nunca
-- foi arquivado fica com "archivedAt" NULL, que é exatamente o que as
-- listagens passam a exigir.

ALTER TABLE "Deal" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Deal" ADD COLUMN "archivedById" TEXT;

CREATE INDEX "Deal_organizationId_archivedAt_idx" ON "Deal"("organizationId", "archivedAt");
