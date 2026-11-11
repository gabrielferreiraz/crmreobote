-- Comprovante de pagamento (Pix) anexado ao cadastro do Ganho quando a forma de pagamento é PIX.
-- Migration aditiva: só acrescenta um valor ao enum; nenhum documento existente muda.
ALTER TYPE "DealRegistrationDocKind" ADD VALUE IF NOT EXISTS 'PAYMENT_PROOF';
