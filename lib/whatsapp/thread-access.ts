import { canReadCentralThread, getCentralAccess } from "@/lib/whatsapp/central-access";

type ThreadOwnership = {
  inboxStatus: "OPEN" | "CLOSED" | null;
  ownerUserId: string | null;
  assigneeId: string | null;
};

export async function getWhatsAppThreadAccess(
  organizationId: string,
  userId: string,
  role: string | undefined,
  thread: ThreadOwnership,
) {
  const access = await getCentralAccess(organizationId, userId, role);
  if (thread.inboxStatus) {
    const canRead = canReadCentralThread(access, thread);
    return {
      canRead,
      canSend: canRead && thread.inboxStatus === "OPEN" && thread.assigneeId === userId,
      isCentral: true,
      isResponsibleViewer: thread.assigneeId === userId,
    };
  }

  const canRead = access.scope.type === "all" || Boolean(
    thread.ownerUserId && access.scope.ownerIds.includes(thread.ownerUserId),
  );
  return {
    canRead,
    canSend: canRead,
    isCentral: false,
    isResponsibleViewer: !thread.ownerUserId || thread.ownerUserId === userId,
  };
}
