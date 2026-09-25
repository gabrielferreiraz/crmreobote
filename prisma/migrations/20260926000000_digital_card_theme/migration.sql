-- Tema do Cartão Digital (escuro / claro / foto no fundo) — pedido explícito:
-- "o usuário escolhe se ele quer tema claro, tema escuro ou colocar a foto no
-- fundo". Coluna OPCIONAL: NULL = a pessoa nunca escolheu, então o cartão
-- segue o padrão da organização (chave `theme` de
-- Organization.digitalCardDefaults, OWNER-only) e, se a org também não tiver
-- definido, o tema de fábrica DARK (comportamento de sempre).
CREATE TYPE "DigitalCardTheme" AS ENUM ('DARK', 'LIGHT', 'PHOTO');

ALTER TABLE "DigitalCard" ADD COLUMN "theme" "DigitalCardTheme";
