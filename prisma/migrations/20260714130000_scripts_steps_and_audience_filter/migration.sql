-- MessageScript: texto único vira sequência de mensagens (steps) + tags livres.
ALTER TABLE "MessageScript" ADD COLUMN "steps" JSONB;
ALTER TABLE "MessageScript" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "MessageScript"
SET "steps" = jsonb_build_array(jsonb_build_object('text', "text", 'delayAfterSec', 0));

ALTER TABLE "MessageScript" ALTER COLUMN "steps" SET NOT NULL;
ALTER TABLE "MessageScript" ALTER COLUMN "tags" SET NOT NULL;
ALTER TABLE "MessageScript" DROP COLUMN "text";

-- Campaign: audienceJobTitle (texto exato) vira audienceFilter (cargos/tags/cidades).
ALTER TABLE "Campaign" ADD COLUMN "audienceFilter" JSONB;

UPDATE "Campaign"
SET "audienceFilter" = jsonb_build_object(
  'jobTitles', CASE WHEN "audienceJobTitle" IS NOT NULL THEN jsonb_build_array("audienceJobTitle") ELSE '[]'::jsonb END,
  'tags', '[]'::jsonb,
  'cities', '[]'::jsonb
);

ALTER TABLE "Campaign" ALTER COLUMN "audienceFilter" SET NOT NULL;
ALTER TABLE "Campaign" DROP COLUMN "audienceJobTitle";
