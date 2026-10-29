-- Planilhas: marcações de célula e aparência de tabela (estilo Excel).
-- Migration ADITIVA: duas colunas novas com valor padrão; nada existente muda.
ALTER TABLE "Sheet" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "SheetRow" ADD COLUMN "formats" JSONB NOT NULL DEFAULT '{}';
