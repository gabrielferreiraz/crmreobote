import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope, whatsappThreadScopeWhere } from "@/lib/team-scope";
import { recordUserChange } from "@/lib/user-activity";
import { fetchSavedContactName } from "@/lib/evolution";

export const dynamic = "force-dynamic";

/**
 * Melhor-esforço: tenta puxar da Evolution o nome que o dono do WhatsApp
 * conectado salvou pra esse número na agenda do próprio celular (ver
 * comentário completo em lib/evolution.ts's fetchSavedContactName — não é
 * garantido, depende da agenda do celular estar sincronizada e da versão do
 * Evolution guardar esse campo). Só EVOLUTION tem essa noção — instância
 * META_CLOUD não expõe agenda de celular nenhuma, então nem tenta.
 * Não é erro nenhum dos dois vir vazio; devolve `{name: null}` nesse caso.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;

  const { session, organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const scope = await getDealScope(organizationId, userId, session!.user.role);
    const thread = await prisma.whatsAppThread.findFirst({
      where: { id: threadId, organizationId, ...whatsappThreadScopeWhere(scope) },
      select: {
        phoneNormalized: true,
        instance: { select: { provider: true, instanceName: true, status: true } },
      },
    });
    if (!thread) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    if (!thread.instance || thread.instance.provider !== "EVOLUTION" || thread.instance.status !== "CONNECTED") {
      return NextResponse.json({ name: null });
    }

    // Mesma convenção de lib/whatsapp/send.ts: phoneNormalized nunca inclui
    // o DDI do Brasil, precisa acrescentar na hora de falar com o Evolution.
    const fullNumber = `55${thread.phoneNormalized}`;
    const name = await fetchSavedContactName(thread.instance.instanceName, fullNumber);
    return NextResponse.json({ name });
  });
}

/**
 * Renomeia o que aparece pra essa conversa em Conversas (ver
 * lib/whatsapp/conversations.ts's displayName) — um único endpoint, mas o
 * destino de verdade muda conforme a conversa já tem contato vinculado ou
 * não, pra quem chama nunca precisar saber qual dos dois:
 *
 *  - Com contato (aba "WhatsApp CRM"): edita Contact.name — é a identidade
 *    "oficial" usada em todo o CRM (Clientes, Pipeline, negócios), não só
 *    aqui. Reaproveita a mesma coluna que o formulário de Clientes edita.
 *  - Sem contato (aba "WhatsApp Geral"): edita WhatsAppThread.customName —
 *    não existe Contact ainda pra guardar um nome, então o apelido fica na
 *    própria thread (ver schema.prisma's comentário no campo).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const body = await req.json();
  const { name } = body as { name?: string };

  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return NextResponse.json({ error: "Digite um nome" }, { status: 400 });

  const { session, organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    // Mesma regra de escopo de quem pode ABRIR a conversa (ver
    // lib/whatsapp/conversations.ts) — um Membro não pode renomear conversa
    // de outro vendedor só porque sabe o threadId.
    const scope = await getDealScope(organizationId, userId, session!.user.role);
    const thread = await prisma.whatsAppThread.findFirst({
      where: { id: threadId, organizationId, ...whatsappThreadScopeWhere(scope) },
      select: { id: true, contactId: true },
    });
    if (!thread) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    if (thread.contactId) {
      await prisma.contact.update({ where: { id: thread.contactId }, data: { name: trimmed } });
    } else {
      await prisma.whatsAppThread.update({ where: { id: thread.id }, data: { customName: trimmed } });
    }

    recordUserChange(organizationId, userId).catch((err) =>
      console.error("[user-activity] falha ao registrar alteração", err),
    );

    return NextResponse.json({ displayName: trimmed });
  });
}
