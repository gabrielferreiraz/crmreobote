-- Índices de performance achados num pente fino com EXPLAIN (ANALYZE) rodado
-- contra o banco de PRODUÇÃO (dentro do contexto de RLS, senão a policy
-- zera as linhas e o plano sai "never executed"). Cada tempo abaixo é
-- medido, não estimado:
--
--   Início "negócios parados"        283 ms  Seq Scan em Deal   → índice 1
--   Pipeline contagem por etapa      130 ms  Seq Scan em Deal   → índice 2
--   Início soma do pipeline aberto    67 ms  Seq Scan em Deal   → índice 2
--   Início "atividades recentes"      10 ms  Seq Scan em Activity → índice 3
--   Clientes filtro por tag rara     483 ms  varredura do índice de createdAt → índice 4
--
-- CONCURRENTLY (mesmo motivo de 20260914120000_restore_trgm_indexes): as
-- tabelas têm ~142k (Contact), ~20k (Deal) e ~14k (Activity) linhas em
-- produção viva — CREATE INDEX comum trava ESCRITA na tabela inteira até
-- terminar. CONCURRENTLY não trava, ao custo de cada comando precisar rodar
-- FORA de transação (por isso aplicados um a um, nunca dentro de
-- $transaction).

-- 1) Início: negócios parados há N dias (status + ordenação por stageEnteredAt).
--    O índice existente (organizationId, pipelineId, status, stageEnteredAt)
--    não serve aqui porque esta consulta NÃO filtra por funil — pipelineId
--    está no meio do índice, então o prefixo não casa.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Deal_organizationId_status_stageEnteredAt_idx"
  ON "Deal" ("organizationId", "status", "stageEnteredAt");

-- 2) Pipeline/Início: agregação por etapa (count + sum(value)) dos negócios
--    abertos. INCLUDE ("value") é o ponto principal: status='OPEN' casa com
--    a maior parte da tabela, então sem o valor DENTRO do índice o Postgres
--    tem que visitar o heap linha a linha e prefere o Seq Scan de novo —
--    com INCLUDE vira index-only scan e a soma sai do próprio índice.
--
--    ATENÇÃO: INCLUDE não é representável em schema.prisma (igual aos
--    índices GIN/trigram — ver 20260914120000_restore_trgm_indexes), então
--    este índice NÃO está no schema e um `prisma migrate dev` vai querer
--    derrubá-lo. Se sumir do banco, recriar com esta mesma migration.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Deal_org_status_stage_value_idx"
  ON "Deal" ("organizationId", "status", "stageId") INCLUDE ("value");

-- 3) Início: últimas atividades (ordenação por createdAt). Os índices atuais
--    de Activity são todos por (organizationId, dealId|processId, createdAt)
--    — nenhum serve pra "as mais recentes da organização toda", que é
--    exatamente o que o Início pede.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Activity_organizationId_createdAt_idx"
  ON "Activity" ("organizationId", "createdAt");

-- 4) Clientes: filtro por tag (Contact.tags é text[], operador @>). Sem GIN,
--    filtrar por uma tag POUCO usada faz o Postgres varrer o índice de
--    createdAt pra trás linha a linha até juntar a página — 483 ms medidos.
--    Mesma limitação do INCLUDE acima: GIN não é representável em
--    schema.prisma.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Contact_tags_gin_idx"
  ON "Contact" USING gin (tags);
