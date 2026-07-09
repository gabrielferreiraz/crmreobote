-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "lossReasonId" TEXT;

-- CreateTable
CREATE TABLE "LossReason" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LossReason_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LossReason_organizationId_idx" ON "LossReason"("organizationId");

-- CreateIndex
CREATE INDEX "Deal_organizationId_lossReasonId_idx" ON "Deal"("organizationId", "lossReasonId");

-- AddForeignKey
ALTER TABLE "LossReason" ADD CONSTRAINT "LossReason_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_lossReasonId_fkey" FOREIGN KEY ("lossReasonId") REFERENCES "LossReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;
