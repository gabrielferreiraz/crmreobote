-- "Rodar robô agora" roda no robô do computador de quem clicou: a execução
-- manual guarda o computador escolhido e só ele pode reivindicá-la. Execuções
-- agendadas (dia 1) continuam sem destino (qualquer computador online).
-- Aditiva: coluna nova opcional; nada existente muda.

ALTER TABLE "ServopaSyncRun" ADD COLUMN "targetWorkerId" TEXT;

ALTER TABLE "ServopaSyncRun"
  ADD CONSTRAINT "ServopaSyncRun_targetWorkerId_fkey"
  FOREIGN KEY ("targetWorkerId") REFERENCES "ServopaWorker"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
