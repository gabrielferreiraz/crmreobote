-- AlterTable: marca quando o histórico de mensagens (pré-conexão) já foi importado.
ALTER TABLE "WhatsAppInstance" ADD COLUMN "historySyncedAt" TIMESTAMP(3);
