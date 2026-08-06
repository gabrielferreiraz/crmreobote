-- Busca por nome do responsável (owner.name) entrou em buildDealsWhere
-- (ver "Adicionar ao processo") — sem índice trigram (pg_trgm já habilitado
-- desde 20260714150000_search_trigram_indexes), esse `contains` cai num
-- scan sem índice, igual aconteceria com Contact.name/Deal.name se não
-- tivessem o deles.
CREATE INDEX IF NOT EXISTS "User_name_trgm_idx" ON "User" USING gin (name gin_trgm_ops);
