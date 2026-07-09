-- DropForeignKey
ALTER TABLE "Company" DROP CONSTRAINT "Company_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Contact" DROP CONSTRAINT "Contact_companyId_fkey";

-- AlterTable
ALTER TABLE "Contact" DROP COLUMN "companyId";

-- DropTable
DROP TABLE "Company";
