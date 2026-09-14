-- Recria os índices trigram que sumiram do banco real (nenhum "trgm" restava
-- em pg_indexes, confirmado por script de diagnóstico) mesmo com as
-- migrations que os criam (20260714150000_search_trigram_indexes,
-- 20260731090000_contact_state_city_filter_indexes,
-- 20260805170000_user_name_trgm_index) marcadas como aplicadas em
-- _prisma_migrations. Causa: pg_trgm/GIN não é modelado em schema.prisma
-- (o gerador "prisma-client" não suporta isso), então QUALQUER
-- `prisma migrate dev`/`migrate diff` rodado neste repo não os "enxerga" e
-- tenta derrubá-los de novo — já documentado em
-- 20260715175725_add_custom_fields_and_lead_sources, mas o aviso não
-- impede outra execução de migrate dev de repetir o mesmo problema. Efeito
-- em produção: busca de cliente por nome/telefone (141k+ contatos) virava
-- Seq Scan na tabela inteira — ~100-250ms+ por busca RARA (nome ou telefone
-- completo, o caso comum de "procurar ESTE cliente"), e Promise.all dobra
-- isso (fetchContactsList + countContacts rodam o mesmo Seq Scan em
-- paralelo) — motivo relatado pelo usuário: "demora e demora bem".
--
-- CONCURRENTLY (não usado nas migrations originais) de propósito aqui: as
-- tabelas já têm ~142k (Contact) e ~119k (Deal) linhas em produção viva —
-- um CREATE INDEX comum trava escrita na tabela inteira até terminar de
-- construir o índice; CONCURRENTLY evita isso ao custo de rodar cada
-- comando fora de transação (por isso são aplicados um a um, nunca dentro
-- de $transaction, ver como esta migration foi executada).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Contact_name_trgm_idx" ON "Contact" USING gin (name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Contact_company_trgm_idx" ON "Contact" USING gin (company gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Contact_email_trgm_idx" ON "Contact" USING gin (email gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Contact_phoneNormalized_trgm_idx" ON "Contact" USING gin ("phoneNormalized" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Contact_whatsappNormalized_trgm_idx" ON "Contact" USING gin ("whatsappNormalized" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Contact_city_trgm_idx" ON "Contact" USING gin (city gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Deal_name_trgm_idx" ON "Deal" USING gin (name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_name_trgm_idx" ON "User" USING gin (name gin_trgm_ops);
