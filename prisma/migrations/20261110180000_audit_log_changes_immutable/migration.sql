-- Auditoria completa: o que mudou (antes -> depois), nome do item e índices para buscar por pessoa,
-- por ação e pelo histórico de um item. Migration aditiva (colunas opcionais + índices).
ALTER TABLE "AuditLog" ADD COLUMN "targetLabel" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "changes" JSONB;

CREATE INDEX "AuditLog_organizationId_targetType_targetId_createdAt_idx" ON "AuditLog"("organizationId", "targetType", "targetId", "createdAt");
CREATE INDEX "AuditLog_organizationId_actorUserId_createdAt_idx" ON "AuditLog"("organizationId", "actorUserId", "createdAt");
CREATE INDEX "AuditLog_organizationId_action_createdAt_idx" ON "AuditLog"("organizationId", "action", "createdAt");

-- O registro de auditoria é somente de inclusão: ninguém (nem o sistema) altera ou apaga um evento.
-- Exceções que o próprio banco precisa fazer:
--  * pessoa apagada: a chave estrangeira zera "actorUserId" (o nome do autor continua em "actorName");
--  * organização apagada: os eventos dela saem junto (exclusão em cascata).
CREATE OR REPLACE FUNCTION audit_log_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."actorUserId" IS NULL AND (to_jsonb(NEW) - 'actorUserId') = (to_jsonb(OLD) - 'actorUserId') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'AuditLog é somente de inclusão: o evento % não pode ser alterado', OLD."id";
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'AuditLog é somente de inclusão: o evento % não pode ser apagado', OLD."id";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_guard_trigger
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
