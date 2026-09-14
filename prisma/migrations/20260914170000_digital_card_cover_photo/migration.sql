-- Foto de capa (banner) do Cartão Digital — pedido explícito depois da
-- conversa sobre a ideia do Gemini pra foto de fundo do cartão. Override
-- opcional por cartão; sem ela, cai pro padrão da organização (quando
-- configurado, ver lib/digital-cards/config.ts) ou pro gradiente abstrato.
ALTER TABLE "DigitalCard" ADD COLUMN "coverPhotoKey" TEXT;
