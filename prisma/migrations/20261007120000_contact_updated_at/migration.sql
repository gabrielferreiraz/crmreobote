-- Contact.updatedAt — "Última atualização" do contato (ver o campo no
-- schema). Alimenta o filtro novo da página de Clientes, pedido pra conferir
-- o que uma importação acabou de mexer: a importação agora atualiza contato
-- que já existe com o que a planilha traz de diferente (ver
-- app/api/contacts/import/route.ts), então precisa de um jeito de achar
-- quem mudou.
--
-- Escrito À MÃO, não gerado por `prisma migrate dev`: o diff automático
-- deste schema quer DERRUBAR todos os índices trigram/GIN (Contact_name_trgm_idx,
-- Contact_tags_gin_idx, …) porque o Prisma não os modela, e ainda arrasta
-- mudanças de outras pessoas que estão em andamento (AutomationRule.actions,
-- enum AutomationAction). Aqui vai SÓ o que esta mudança precisa.
--
-- Backfill com createdAt em vez de deixar o DEFAULT carimbar tudo com a hora
-- do deploy: "nunca mudou desde que entrou" é a verdade pros contatos
-- antigos, e carimbar 140 mil linhas com a data de hoje tornaria o filtro
-- inútil justamente no primeiro uso (todo mundo apareceria como "atualizado
-- hoje").
-- IF NOT EXISTS em tudo: a migração roda contra o banco REAL (é o mesmo que
-- a aplicação usa, não existe banco de desenvolvimento separado aqui), e um
-- `db execute` interrompido no meio precisa poder ser repetido sem erro em
-- vez de exigir conserto manual. O UPDATE de backfill também é idempotente
-- pelo próprio WHERE ("IS NULL").
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

UPDATE "Contact" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

ALTER TABLE "Contact" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Contact" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- Intervalo de data sobre a carteira inteira (141 mil linhas) — sem índice,
-- o filtro vira varredura + ordenação em memória, mesmo motivo do
-- (organizationId, createdAt) que já existe.
CREATE INDEX IF NOT EXISTS "Contact_organizationId_updatedAt_idx" ON "Contact"("organizationId", "updatedAt");
