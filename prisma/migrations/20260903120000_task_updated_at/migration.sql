-- Task era o único modelo tenant-scoped grande sem @updatedAt. Motivo real:
-- a migração do Agendor (scripts/agendor/import-tarefas.ts) precisa de um
-- jeito de saber se uma Task já importada mudou de data/hora do lado de lá
-- (consultor arrasta a ligação pra outro dia direto no Agendor) sem
-- arriscar reverter uma mudança feita AO VIVO aqui no CRM — mesma guarda
-- que Deal.updatedAt já dá pra syncExistingDeal.
--
-- Backfill com "createdAt" (não "now()"/CURRENT_TIMESTAMP) de propósito: se
-- toda Task existente ganhasse updatedAt = agora (hoje, no momento desta
-- migração), a PRÓXIMA importação acharia que TODA "Data de atualização" da
-- planilha do Agendor (datas passadas, meses atrás em geral) é mais ANTIGA
-- que o nosso updatedAt fictício — a guarda de sincronização nunca deixaria
-- passar nada, nem as 3 tarefas do Eduardo Fujiyama que motivaram esta
-- migração (atualizadas 01/09, ficariam "mais antigas" que um updatedAt de
-- 03/09). createdAt como baseline é semanticamente correto (uma linha nunca
-- editada tem "última mexida = quando foi criada") e deixa qualquer
-- "Data de atualização" real do Agendor already-existente contar como mais
-- nova, disparando a sincronização já na próxima importação.
ALTER TABLE "Task" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "Task" SET "updatedAt" = "createdAt";
ALTER TABLE "Task" ALTER COLUMN "updatedAt" SET NOT NULL;
