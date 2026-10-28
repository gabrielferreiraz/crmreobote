-- Capa da proposta passa a nascer com a foto ANTES do texto (logo abaixo do
-- logotipo) em vez de depois do título — ver coverImagePosition no model
-- Proposal. Pedido explícito: o layout com a foto no topo virou o padrão da
-- empresa.
--
-- Só o DEFAULT muda. Proposta já existente mantém o valor que tem gravado:
-- várias já foram geradas/enviadas ao cliente nesse formato, e reescrever a
-- coluna mudaria o documento de propostas que o cliente já recebeu.
-- Quem quiser trocar uma delas continua usando o botão "Mover foto" na capa.
--
-- Escrita à mão (não gerada por `prisma migrate dev`): a shadow database do
-- migrate dev falha numa migração ANTERIOR e não relacionada
-- (20260812090000_tv_dashboard_config_rls, ver comentário lá).

ALTER TABLE "Proposal" ALTER COLUMN "coverImagePosition" SET DEFAULT 'before-copy';
