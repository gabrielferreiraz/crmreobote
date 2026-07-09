-- Novos gatilhos e ações de automação
ALTER TYPE "AutomationTrigger" ADD VALUE 'DEAL_STAGE_ENTERED';
ALTER TYPE "AutomationTrigger" ADD VALUE 'DEAL_NO_OPEN_TASK';
ALTER TYPE "AutomationTrigger" ADD VALUE 'CONTACT_NO_DEAL';
ALTER TYPE "AutomationAction" ADD VALUE 'MARK_LOST';
