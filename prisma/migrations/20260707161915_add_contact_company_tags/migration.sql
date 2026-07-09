-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "company" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
