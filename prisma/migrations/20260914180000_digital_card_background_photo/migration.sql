-- Foto de fundo do CORPO INTEIRO do Cartão Digital — pedido explícito:
-- "a capa de fundo atrás do avatar e outra de fundo com todo o corpo do
-- cartão" são duas imagens distintas na referência. Override opcional por
-- cartão (mesmo mecanismo de coverPhotoKey: padrão da organização quando
-- configurado, voltar ao padrão ao remover).
ALTER TABLE "DigitalCard" ADD COLUMN "backgroundPhotoKey" TEXT;
