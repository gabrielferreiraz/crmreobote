-- Process.contactId vira opcional e ganha Process.clientName — ver comentário
-- no model Process (schema).
--
-- Motivo: o administrativo acompanha contemplado que não é (nem precisa virar)
-- contato deste CRM. Antes, criar esse processo obrigava a cadastrar a pessoa
-- em Clientes só para destravar — pedido explícito de que o dado fique apenas
-- na seção Processos.
--
-- Regra de uso: ou `contactId` (nome vem do contato, processo tem telefone e
-- WhatsApp) ou `clientName` (só rótulo, ações que dependem de telefone não se
-- aplicam). Quem lê usa `contact?.name ?? clientName`.
--
-- Aditivo nos dois passos: DROP NOT NULL não reescreve linha nenhuma, e a
-- coluna nova nasce NULL em todas as linhas existentes (que continuam tendo
-- contactId preenchido, logo continuam lendo o nome pelo contato).
--
-- Escrita à mão (não gerada por `prisma migrate dev`): a shadow database do
-- migrate dev falha numa migração ANTERIOR e não relacionada
-- (20260812090000_tv_dashboard_config_rls, ver comentário lá), então toda
-- migração nova neste repo é escrita e aplicada manualmente.

ALTER TABLE "Process" ALTER COLUMN "contactId" DROP NOT NULL;
ALTER TABLE "Process" ADD COLUMN "clientName" TEXT;
