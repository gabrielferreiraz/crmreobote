-- Planilhas: fórmulas por célula (formato interno de lib/sheets/formula.ts).
-- Migration ADITIVA: uma coluna nova com valor padrão; nada existente muda.
ALTER TABLE "SheetRow" ADD COLUMN "formulas" JSONB NOT NULL DEFAULT '{}';
