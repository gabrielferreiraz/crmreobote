-- Novo tipo de campo personalizado: CPF (máscara + validação de dígito
-- verificador, ver lib/cpf.ts). Só ADICIONA um valor ao enum — nada existente
-- muda e nenhuma linha é tocada. ADD VALUE não pode ser usado na mesma
-- transação em que foi criado, por isso esta migração NÃO converte o campo
-- "CPF" que já existe como TEXT: isso é um UPDATE à parte (ver o passo de
-- conversão combinado com o dono da organização).
ALTER TYPE "CustomFieldType" ADD VALUE IF NOT EXISTS 'CPF';
