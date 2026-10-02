-- O default preserva todos os usuarios existentes como liberados. Somente a
-- criacao de novos MEMBER + VENDAS passa a gravar REQUIRED explicitamente.
CREATE TYPE "AcademyOnboardingStatus" AS ENUM ('NOT_REQUIRED', 'REQUIRED', 'STARTED', 'CRM_UNLOCKED');

ALTER TABLE "OrganizationUser"
ADD COLUMN "academyOnboardingStatus" "AcademyOnboardingStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN "academyShortcutHintSeenAt" TIMESTAMP(3);
