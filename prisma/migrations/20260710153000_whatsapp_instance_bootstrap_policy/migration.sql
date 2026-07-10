-- O webhook do Evolution API (sem sessão de usuário) só conhece o
-- instanceName, não o organizationId — precisa achar a própria linha antes de
-- saber a qual organização ela pertence. Mesmo padrão já usado em
-- "OrganizationUser" para o bootstrap do login.
DROP POLICY tenant_isolation ON "WhatsAppInstance";

CREATE POLICY tenant_isolation ON "WhatsAppInstance"
  USING (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR "instanceName" = current_setting('app.current_instance_name', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR "instanceName" = current_setting('app.current_instance_name', true)
  );
