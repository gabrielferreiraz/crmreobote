"use client";

import { useDesktopViewport } from "@/lib/use-desktop-viewport";
import dynamic from "next/dynamic";
import type { Conversation, NotificationPrefs } from "./conversations-view";

const ConversationsView = dynamic(() => import("./conversations-view").then((mod) => mod.ConversationsView));
const ConversationsMobile = dynamic(() =>
  import("./conversations-view-mobile").then((mod) => mod.ConversationsMobile),
);

type ResponsiveConversationsProps = {
  initialConversations: Conversation[];
  currentUserId: string;
  notificationPrefs: NotificationPrefs;
  whatsappConnected: boolean;
};

/**
 * Monta somente uma interface de conversas. Antes desktop e mobile ficavam
 * vivos ao mesmo tempo, apenas escondidos por CSS, duplicando buscas e SSE.
 */
export function ResponsiveConversations(props: ResponsiveConversationsProps) {
  const desktop = useDesktopViewport();

  if (desktop === null) {
    return (
      <div
        className="card min-h-0 flex-1 animate-pulse bg-neutral-100 dark:bg-neutral-900"
        aria-label="Carregando conversas"
      />
    );
  }

  if (desktop) return <ConversationsView {...props} />;

  return (
    <div className="min-h-0 flex-1">
      <ConversationsMobile
        initialConversations={props.initialConversations}
        currentUserId={props.currentUserId}
        notificationPrefs={props.notificationPrefs}
      />
    </div>
  );
}
