-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "meetingInviteSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrganizationUser" ADD COLUMN     "meetingInviteTemplate" TEXT;
