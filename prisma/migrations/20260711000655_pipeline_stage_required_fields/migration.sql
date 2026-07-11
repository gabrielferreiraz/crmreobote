-- AlterTable: substitui o booleano único "requiresValue" por uma lista
-- genérica de campos obrigatórios por etapa.
ALTER TABLE "PipelineStage" ADD COLUMN "requiredFields" TEXT[] NOT NULL DEFAULT '{}';

-- Backfill: preserva o comportamento das etapas já configuradas
-- (requiresValue = true vira requiredFields = ['value']).
UPDATE "PipelineStage" SET "requiredFields" = ARRAY['value'] WHERE "requiresValue" = true;

ALTER TABLE "PipelineStage" DROP COLUMN "requiresValue";
