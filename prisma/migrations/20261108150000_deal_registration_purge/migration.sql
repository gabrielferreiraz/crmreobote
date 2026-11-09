-- Retenção dos documentos do cadastro do cliente (apagados do R2 7 dias após o Ganho).
-- Migration aditiva: uma coluna opcional.
ALTER TABLE "DealRegistration" ADD COLUMN "documentsPurgedAt" TIMESTAMP(3);
