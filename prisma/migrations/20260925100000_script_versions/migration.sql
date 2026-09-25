-- Versão de medição de scripts (ver comentário em MessageScript.version no
-- schema.prisma): sobe só quando quem edita escolhe "nova versão"; cada envio
-- de campanha grava a versão que usou. Só colunas novas — nada existente é
-- alterado. ADD COLUMN nullable sem default em CampaignRecipient é só
-- metadado no Postgres (instantâneo, não reescreve a tabela).

-- AlterTable
ALTER TABLE "MessageScript" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "versionHistory" JSONB;

-- AlterTable
ALTER TABLE "CampaignRecipient" ADD COLUMN "scriptVersion" INTEGER,
ADD COLUMN "followUpScriptVersion" INTEGER;
