import { auth } from "@/lib/auth";
import { centralLeadsEnabled } from "@/lib/whatsapp/central-config";
import { CentralView } from "./central-view";

/**
 * Central de Leads: um número da EMPRESA (não de um consultor) que recebe os
 * leads e distribui entre os consultores. A lista e as ações vêm de
 * /api/whatsapp/central/* — esta página só decide o que mostrar por papel.
 */
export default async function CentralPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  // ?c=<threadId>: link do push ("nova conversa"/"transferida para você") abre direto nela.
  const { c } = await searchParams;
  const initialThreadId = typeof c === "string" && c.length <= 64 ? c : null;
  const role = session!.user.role;
  const canManageQueue = role === "OWNER" || role === "MANAGER" || role === "SUPERVISOR";

  if (!centralLeadsEnabled()) {
    return (
      <div className="card flex h-full items-center justify-center p-8 text-center text-sm text-neutral-500">
        Central de Leads desligada.
      </div>
    );
  }

  return (
    <CentralView
      currentUserId={session!.user.id}
      canManageQueue={canManageQueue}
      isOwner={role === "OWNER"}
      initialThreadId={initialThreadId}
    />
  );
}
