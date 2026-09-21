-- Padrão de fotos do Cartão Digital escolhido pelo DONO (ver
-- lib/digital-cards/config.ts pro padrão "de fábrica" hardcoded e
-- Organization.digitalCardDefaults no schema) — coluna opcional, nula =
-- comportamento de sempre (cai pro padrão de fábrica/gradiente).
ALTER TABLE "Organization" ADD COLUMN "digitalCardDefaults" JSONB;
