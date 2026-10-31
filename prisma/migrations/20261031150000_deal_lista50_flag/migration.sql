-- Marcador durável "este negócio nasceu da campanha Lista dos 50" —
-- independente da etapa atual do pipeline (o consultor arrasta o negócio
-- normalmente depois de entregue). Migration aditiva: só coluna + índices.

ALTER TABLE "Deal" ADD COLUMN "lista50" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Deal_organizationId_lista50_ownerId_createdAt_idx" ON "Deal"("organizationId", "lista50", "ownerId", "createdAt");
CREATE INDEX "Deal_organizationId_lista50_contactId_ownerId_idx" ON "Deal"("organizationId", "lista50", "contactId", "ownerId");
