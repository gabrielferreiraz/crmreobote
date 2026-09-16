-- Duas correções da revisão de código do Cartão Digital:
--
-- 1) DigitalCard.selectedLogos — a UI de reordenar/ligar-desligar logo em
--    "Meu Cartão" (card-editor.tsx) só existia como useState local, sem
--    coluna nenhuma pra guardar — qualquer alteração se perdia ao recarregar
--    a página. Array de "key" (ver lib/digital-cards/logos.ts), na ordem de
--    exibição; vazio = cai pro DEFAULT_SELECTED_LOGOS (comportamento atual,
--    todas as logos na ordem padrão) — nunca some logo nenhuma só por causa
--    desta migration. RLS: a policy tenant_isolation de DigitalCard já
--    existe (linha, não coluna) e cobre a coluna nova automaticamente.
--
-- 2) DigitalCardEventType.QR_CODE_OPEN — o botão "QR Code"/abertura
--    automática via ?qr=1 (digital-card-actions.tsx) sempre tentava gravar
--    esse eventType, mas ele nunca existiu no enum — todo POST em
--    /api/public/cards/[slug]/events pra esse clique dava 400 silencioso.
ALTER TABLE "DigitalCard" ADD COLUMN "selectedLogos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TYPE "DigitalCardEventType" ADD VALUE 'QR_CODE_OPEN';
