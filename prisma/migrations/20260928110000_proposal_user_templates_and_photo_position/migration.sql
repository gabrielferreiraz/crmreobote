ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "coverImagePosition" TEXT NOT NULL DEFAULT 'after-title';

ALTER TABLE "ProposalTemplate" ADD COLUMN IF NOT EXISTS "createdById" TEXT;

DROP INDEX IF EXISTS "ProposalTemplate_organizationId_name_key";
CREATE UNIQUE INDEX "ProposalTemplate_organizationId_createdById_name_key" ON "ProposalTemplate"("organizationId", "createdById", "name");
CREATE INDEX "ProposalTemplate_createdById_idx" ON "ProposalTemplate"("createdById");
ALTER TABLE "ProposalTemplate" ADD CONSTRAINT "ProposalTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
