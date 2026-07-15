-- A policy de ApiKey criada na migração anterior deixou o WITH CHECK só com
-- a cláusula de organizationId, sem o OR keyHash — diferente do padrão já
-- usado em WhatsAppInstance (20260710153000_whatsapp_instance_bootstrap_policy),
-- que inclui as duas cláusulas também no WITH CHECK. Sem isso, um UPDATE
-- feito só com o contexto de bootstrap (app.current_api_key_hash, sem
-- organizationId — ex.: atualizar lastUsedAt na autenticação) falha a
-- checagem da RLS.
DROP POLICY tenant_isolation ON "ApiKey";

CREATE POLICY tenant_isolation ON "ApiKey"
  USING (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR "keyHash" = current_setting('app.current_api_key_hash', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR "keyHash" = current_setting('app.current_api_key_hash', true)
  );
