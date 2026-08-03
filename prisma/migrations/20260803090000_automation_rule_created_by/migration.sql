-- Automações agora podem ser criadas por Supervisor/Consultor também (antes
-- só OWNER/MANAGER) — cada um só enxerga/gerencia as próprias (ver GET/PATCH/
-- DELETE em app/api/automations). Regras já existentes ficam com
-- createdById NULL (visíveis só a OWNER/MANAGER, igual ao comportamento de
-- antes desta coluna existir).
ALTER TABLE "AutomationRule" ADD COLUMN "createdById" TEXT;

ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AutomationRule_organizationId_createdById_idx" ON "AutomationRule"("organizationId", "createdById");
