-- AlterTable: remove campos de consórcio não usados (prazo/grupo/cota/contemplação) do Deal.
ALTER TABLE "Deal" DROP COLUMN "creditTerm";
ALTER TABLE "Deal" DROP COLUMN "groupNumber";
ALTER TABLE "Deal" DROP COLUMN "quota";
ALTER TABLE "Deal" DROP COLUMN "contemplated";
