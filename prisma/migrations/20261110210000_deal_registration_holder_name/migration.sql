ALTER TABLE "DealRegistration" ADD COLUMN "holderName" TEXT;

UPDATE "DealRegistration" AS registration
SET "holderName" = CASE
  WHEN registration."personType" = 'PJ'
    AND NULLIF(BTRIM(contact."company"), '') IS NOT NULL
    THEN BTRIM(contact."company")
  ELSE BTRIM(contact."name")
END
FROM "Deal" AS deal
JOIN "Contact" AS contact ON contact."id" = deal."contactId"
WHERE registration."dealId" = deal."id"
  AND registration."holderName" IS NULL;
