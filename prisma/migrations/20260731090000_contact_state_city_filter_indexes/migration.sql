-- Filtro de Estado/Cidade em Clientes e Negócios (via Contact). Estado é
-- igualdade exata (lista fechada de UFs) — índice normal. Cidade é busca por
-- trecho (contains, ver lib/contacts/list-query.ts) — precisa de trigram
-- (pg_trgm já habilitado desde 20260714150000_search_trigram_indexes),
-- mesmo padrão já usado em name/company/email/phoneNormalized.
CREATE INDEX "Contact_organizationId_state_idx" ON "Contact"("organizationId", "state");

CREATE INDEX IF NOT EXISTS "Contact_city_trgm_idx" ON "Contact" USING gin (city gin_trgm_ops);
