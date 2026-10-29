-- Vários computadores podem rodar o robô Servopa ao mesmo tempo (ex.: se a
-- pessoa do Administrativo faltar, outro computador assume). Cada computador
-- tem a própria credencial `svw_...`; quem reivindica a fila primeiro executa
-- (FOR UPDATE SKIP LOCKED + índice parcial de um job ativo por organização
-- continuam impedindo duas execuções ao mesmo tempo).
--
-- 1) Remove a trava antiga de "no máximo uma credencial ativa por organização".
-- 2) Guarda qual computador reivindicou cada execução (histórico/diagnóstico).

DROP INDEX IF EXISTS "ServopaWorker_one_active_per_org_key";

ALTER TABLE "ServopaSyncRun" ADD COLUMN "claimedByWorkerId" TEXT;

ALTER TABLE "ServopaSyncRun"
  ADD CONSTRAINT "ServopaSyncRun_claimedByWorkerId_fkey"
  FOREIGN KEY ("claimedByWorkerId") REFERENCES "ServopaWorker"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
