-- "Valor bruto" — independente de Deal.value (que já representa "Valor
-- líquido"), nunca derivado/calculado dele. Pedido da diretoria (08/2026):
-- os dois precisam existir separados desde a criação do negócio, pra
-- relatório/mapeamento/comissão usarem no futuro. Nullable, sem RLS nova
-- (Deal já tem sua política, se aplica automaticamente à coluna nova).
ALTER TABLE "Deal" ADD COLUMN "grossValue" DECIMAL(12,2);
