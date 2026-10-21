-- A Central passa de rodizio uniforme para distribuicao percentual.
ALTER TABLE "LeadDistributionPoolMember"
    ADD COLUMN "distributionPercent" INTEGER NOT NULL DEFAULT 100;

-- Preserva pools existentes dividindo 100% igualmente. Quando a divisao nao
-- e exata, os primeiros membros da ordem atual recebem um ponto adicional.
WITH ranked AS (
    SELECT
        id,
        COUNT(*) OVER (PARTITION BY "poolId") AS member_count,
        ROW_NUMBER() OVER (
            PARTITION BY "poolId"
            ORDER BY "position" ASC, "createdAt" ASC, id ASC
        ) AS member_number
    FROM "LeadDistributionPoolMember"
)
UPDATE "LeadDistributionPoolMember" AS member
SET "distributionPercent" = CASE
    WHEN ranked.member_count > 100 THEN 1
    ELSE FLOOR(100.0 / ranked.member_count)::INTEGER
        + CASE
            WHEN ranked.member_number <= (100 % ranked.member_count) THEN 1
            ELSE 0
          END
END
FROM ranked
WHERE member.id = ranked.id;

ALTER TABLE "LeadDistributionPoolMember"
    ADD CONSTRAINT "LeadDistributionPoolMember_distributionPercent_check"
    CHECK ("distributionPercent" BETWEEN 1 AND 100);
