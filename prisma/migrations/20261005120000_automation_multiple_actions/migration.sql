ALTER TYPE "AutomationAction" ADD VALUE 'CREATE_DEAL';

ALTER TABLE "AutomationRule" ADD COLUMN "actions" JSONB;
