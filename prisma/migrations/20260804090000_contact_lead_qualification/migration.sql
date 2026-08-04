-- CreateEnum
CREATE TYPE "ContactLeadQualification" AS ENUM ('QUALIFIED', 'UNQUALIFIED');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "leadQualification" "ContactLeadQualification",
ADD COLUMN     "leadQualificationAt" TIMESTAMP(3),
ADD COLUMN     "leadQualificationBy" TEXT;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_leadQualificationBy_fkey" FOREIGN KEY ("leadQualificationBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Contact_organizationId_leadQualification_idx" ON "Contact"("organizationId", "leadQualification");

-- CreateIndex
CREATE INDEX "Contact_organizationId_leadQualificationAt_idx" ON "Contact"("organizationId", "leadQualificationAt");
