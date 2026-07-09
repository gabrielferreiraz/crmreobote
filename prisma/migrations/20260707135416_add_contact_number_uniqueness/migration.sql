-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "phoneNormalized" TEXT,
ADD COLUMN     "whatsappNormalized" TEXT;

-- Backfill: calcula a forma normalizada (mesmas regras de lib/phone-normalize.ts)
-- a partir dos valores já existentes em phone/whatsapp.
CREATE OR REPLACE FUNCTION _normalize_phone_number(raw TEXT) RETURNS TEXT AS $$
DECLARE
  digits TEXT;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  digits := regexp_replace(raw, '[^0-9]', '', 'g');
  IF digits = '' THEN RETURN NULL; END IF;
  IF length(digits) > 11 AND left(digits, 2) = '55' AND length(digits) - 2 <= 11 THEN
    digits := substring(digits from 3);
  END IF;
  IF length(digits) > 11 AND left(digits, 1) = '0' THEN
    digits := substring(digits from 2);
  END IF;
  RETURN NULLIF(digits, '');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

UPDATE "Contact" SET "phoneNormalized" = _normalize_phone_number(phone) WHERE phone IS NOT NULL;
UPDATE "Contact" SET "whatsappNormalized" = _normalize_phone_number(whatsapp) WHERE whatsapp IS NOT NULL;

DROP FUNCTION _normalize_phone_number(TEXT);

-- Dados existentes podem já ter duplicados (nunca houve bloqueio antes). Mantém o
-- valor normalizado apenas no contato mais antigo de cada grupo duplicado e limpa
-- os demais, para que a constraint de unicidade abaixo possa ser criada sem falhar.
-- Os telefones brutos (phone/whatsapp) não são alterados.
WITH ranked_phone AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "organizationId", "phoneNormalized" ORDER BY "createdAt" ASC, id ASC
  ) AS rn
  FROM "Contact"
  WHERE "phoneNormalized" IS NOT NULL
)
UPDATE "Contact" SET "phoneNormalized" = NULL
WHERE id IN (SELECT id FROM ranked_phone WHERE rn > 1);

WITH ranked_whatsapp AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "organizationId", "whatsappNormalized" ORDER BY "createdAt" ASC, id ASC
  ) AS rn
  FROM "Contact"
  WHERE "whatsappNormalized" IS NOT NULL
)
UPDATE "Contact" SET "whatsappNormalized" = NULL
WHERE id IN (SELECT id FROM ranked_whatsapp WHERE rn > 1);

-- CreateIndex
CREATE UNIQUE INDEX "Contact_organizationId_phoneNormalized_key" ON "Contact"("organizationId", "phoneNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_organizationId_whatsappNormalized_key" ON "Contact"("organizationId", "whatsappNormalized");
