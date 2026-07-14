-- Habilita busca fuzzy (tolerante a erro de digitação) e ranqueada por
-- relevância na busca geral (⌘K) — ver app/api/search/route.ts. Não é
-- declarado em schema.prisma (o gerador "prisma-client" não modela
-- extensões/índices trigram), então isso é gerenciado só por esta migration.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Contact_name_trgm_idx" ON "Contact" USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Contact_company_trgm_idx" ON "Contact" USING gin (company gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Contact_email_trgm_idx" ON "Contact" USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Contact_phoneNormalized_trgm_idx" ON "Contact" USING gin ("phoneNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Contact_whatsappNormalized_trgm_idx" ON "Contact" USING gin ("whatsappNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Deal_name_trgm_idx" ON "Deal" USING gin (name gin_trgm_ops);
