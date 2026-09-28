-- Taxa percentual da proposta comercial. Default 0 mantém propostas antigas
-- válidas e evita reescrever histórico com um valor presumido.
ALTER TABLE "Proposal" ADD COLUMN "feePercent" DECIMAL(5,2) NOT NULL DEFAULT 0;
