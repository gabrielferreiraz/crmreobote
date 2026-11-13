-- Duas novas áreas de atuação: Financeiro (parcelas e comissões) e Pós-contemplação (processos).
-- Migration aditiva: só acrescenta valores ao enum; ninguém muda de área sozinho.
ALTER TYPE "UserArea" ADD VALUE IF NOT EXISTS 'FINANCEIRO';
ALTER TYPE "UserArea" ADD VALUE IF NOT EXISTS 'POS_CONTEMPLACAO';
