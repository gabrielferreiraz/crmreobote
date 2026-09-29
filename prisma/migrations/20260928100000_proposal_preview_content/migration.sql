ALTER TABLE "Proposal" ADD COLUMN "displayName" TEXT;
ALTER TABLE "Proposal" ADD COLUMN "coverIntro" TEXT;
ALTER TABLE "Proposal" ADD COLUMN "coverDetails" TEXT;

CREATE TABLE "ProposalTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProposalTemplate_organizationId_name_key" ON "ProposalTemplate"("organizationId", "name");
CREATE INDEX "ProposalTemplate_organizationId_idx" ON "ProposalTemplate"("organizationId");
ALTER TABLE "ProposalTemplate" ADD CONSTRAINT "ProposalTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
