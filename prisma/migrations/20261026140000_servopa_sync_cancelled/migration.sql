-- Cancelamento manual é um desfecho próprio: não deve parecer falha nem
-- voltar para a fila automática de retentativas.
ALTER TYPE "ServopaSyncStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
