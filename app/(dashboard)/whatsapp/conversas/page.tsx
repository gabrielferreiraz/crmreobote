import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/r2";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope } from "@/lib/team-scope";
import { listConversations } from "@/lib/whatsapp/conversations";
import { ConversationsView } from "./conversations-view";
import { ConversationsMobile } from "./conversations-view-mobile";

export default async function ConversasPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const userId = session!.user.id;

  return runWithTenant(organizationId, async () => {
    const scope = await getDealScope(organizationId, userId, session!.user.role);
    const conversations = await listConversations(organizationId, scope);
    const currentUserPhotoUrl = await resolveAvatarUrl(session!.user.image);

    // Preferência de notificação é por instância (cada um só recebe push das
    // próprias mensagens) — sem WhatsApp conectado não tem o que configurar.
    const myInstance = await prisma.whatsAppInstance.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { notifyOnCrmMessage: true, notifyOnGeralMessage: true, status: true },
    });
    const notificationPrefs = myInstance ?? { notifyOnCrmMessage: true, notifyOnGeralMessage: true };
    // Sem instância própria conectada, quem está vendo a tela não consegue
    // mandar mensagem nenhuma — a área de chat avisa isso no lugar de
    // "Selecione uma conversa" (ver ConversationsView).
    const myWhatsappConnected = myInstance?.status === "CONNECTED";

    return (
      <div className="flex h-full flex-col gap-4">
        <ConversationsView
          initialConversations={conversations}
          currentUserName={session!.user.name ?? undefined}
          currentUserPhotoUrl={currentUserPhotoUrl}
          currentUserId={userId}
          notificationPrefs={notificationPrefs}
          whatsappConnected={myWhatsappConnected}
        />
        <div className="min-h-0 flex-1 lg:hidden">
          <ConversationsMobile
            initialConversations={conversations}
            currentUserName={session!.user.name ?? undefined}
            currentUserPhotoUrl={currentUserPhotoUrl}
            currentUserId={userId}
            notificationPrefs={notificationPrefs}
          />
        </div>
      </div>
    );
  });
}
