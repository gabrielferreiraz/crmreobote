-- AlterTable
ALTER TABLE "AutomationExecution" ADD COLUMN     "success" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "detail" TEXT;
