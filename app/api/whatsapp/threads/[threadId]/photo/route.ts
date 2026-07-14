import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope } from "@/lib/team-scope";
import { fetchProfilePictureUrl } from "@/lib/evolution";

export const dynamic = "force-dynamic";

// Nem tempo real (foto de perfil quase não muda) nem esquecida pra sempre —
// evita bater no Evolution API a cada vez que o chat é aberto.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/** Foto de perfil do WhatsApp do contato dessa conversa — cacheada em WhatsAppThread (ver prisma/schema.prisma). */
export async function GET(_req: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;

  const { session, organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const thread = await prisma.whatsAppThread.findFirst({
      where: { id: threadId, organizationId },
      include: { instance: { select: { userId: true, instanceName: true, status: true } } },
    });
    if (!thread) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const scope = await getDealScope(organizationId, userId, session!.user.role);
    if (scope.type === "owners" && !scope.ownerIds.includes(thread.instance.userId)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const isFresh = thread.profilePicFetchedAt && Date.now() - thread.profilePicFetchedAt.getTime() < CACHE_TTL_MS;
    if (isFresh) {
      return NextResponse.json({ url: thread.profilePicUrl });
    }

    // Instância desconectada nunca vai responder — não vale a pena marcar o
    // cache como "tentado" (senão, quando reconectar, ficaríamos até 12h sem
    // tentar de novo mesmo já dando certo).
    if (thread.instance.status !== "CONNECTED") {
      return NextResponse.json({ url: thread.profilePicUrl });
    }

    // Mesma convenção de lib/whatsapp/send.ts: phoneNormalized nunca inclui o
    // DDI do Brasil, precisa acrescentar na hora de falar com o Evolution.
    const fullNumber = `55${thread.phoneNormalized}`;
    const url = await fetchProfilePictureUrl(thread.instance.instanceName, fullNumber);

    await prisma.whatsAppThread.update({
      where: { id: threadId },
      data: { profilePicUrl: url, profilePicFetchedAt: new Date() },
    });

    return NextResponse.json({ url });
  });
}
