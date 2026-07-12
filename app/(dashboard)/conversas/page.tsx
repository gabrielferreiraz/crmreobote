import { auth } from "@/lib/auth";
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

    return (
      <div className="flex h-full flex-col gap-4">
        <div className="hidden lg:block">
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Conversas
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Todas as conversas de WhatsApp num só lugar.
          </p>
        </div>
        <ConversationsView
          initialConversations={conversations}
          currentUserName={session!.user.name ?? undefined}
          currentUserPhotoUrl={currentUserPhotoUrl}
          isOwner={session!.user.role === "OWNER"}
        />
        <div className="min-h-0 flex-1 lg:hidden">
          <ConversationsMobile
            initialConversations={conversations}
            currentUserName={session!.user.name ?? undefined}
            currentUserPhotoUrl={currentUserPhotoUrl}
          />
        </div>
      </div>
    );
  });
}
