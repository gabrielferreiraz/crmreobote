import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { notifyLeadRequestCreated, notifyLeadReleased } from "@/lib/lead-requests/notify";
import { evaluateLeadClaim } from "@/lib/lead-claim";

export const dynamic = "force-dynamic";

/** Sino (ver components/notification-bell.tsx) — pedidos PENDING onde eu sou o dono do lead. */
export async function GET() {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const requests = await prisma.leadRequest.findMany({
      where: { organizationId, ownerId: userId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        createdAt: true,
        contact: { select: { id: true, name: true } },
        requester: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json(requests);
  });
}

/**
 * Achado importando contatos (linha duplicada — ver lib/contacts/
 * import-resolve.ts) ou direto na ficha de um contato de outro consultor:
 * quem chama quer este lead pra própria carteira.
 *
 * Dois caminhos bem diferentes, decididos aqui pelo estado ATUAL do lead
 * (nunca confia em nada que o cliente mande sobre isso — regra única em
 * lib/lead-claim.ts):
 *  - Sem responsável, responsável já INATIVO na organização (saiu da
 *    empresa) OU lead PERDIDO há mais de 3 meses (só negócios perdidos,
 *    nenhum aberto/ganho) — reatribui NA HORA, sem pedir nada a ninguém
 *    (ou não existe quem aprovar, ou o prazo já liberou o lead). Só grava
 *    um LeadRequest já-resolvido quando havia de fato um dono antigo, como
 *    rastro de "de quem foi tomado" — sem dono nenhum antes, não há nada
 *    pra registrar. No caso "perdido", o dono anterior (ainda ativo) recebe
 *    um aviso — ele não aprovou nada.
 *  - Responsável ATIVO (e diferente de quem está pedindo) cuidando de um
 *    lead que NÃO está liberado — cria um pedido PENDING e avisa o dono
 *    (push); só ele decide (ver PATCH /api/lead-requests/[id]).
 */
export async function POST(req: Request) {
  const { contactId, targetUserId } = (await req.json()) as { contactId?: string; targetUserId?: string };
  const { organizationId, userId, session } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!contactId) return NextResponse.json({ error: "contactId é obrigatório" }, { status: 400 });
  const requesterName = session?.user.name ?? session?.user.email ?? "Alguém";

  return runWithTenant(organizationId, async () => {
    // Pra quem vai o lead, se diferente de quem está pedindo — caso do
    // admin/assistente importando planilha "pro Fulano" (ver "Responsável
    // pra usar em todos" na importação de contatos). Nunca confia cru no
    // que veio: precisa ser um membro de verdade da mesma organização,
    // senão qualquer um poderia tentar atribuir lead a um id qualquer.
    let target = userId;
    let targetName = requesterName;
    if (targetUserId && targetUserId !== userId) {
      const targetMembership = await prisma.organizationUser.findFirst({
        where: { organizationId, userId: targetUserId },
        select: { user: { select: { id: true, name: true } } },
      });
      if (!targetMembership) return NextResponse.json({ error: "Usuário de destino não encontrado" }, { status: 400 });
      target = targetMembership.user.id;
      targetName = targetMembership.user.name;
    }

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, organizationId },
      select: { id: true, name: true, responsavelId: true },
    });
    if (!contact) return NextResponse.json({ error: "Contato não encontrado" }, { status: 404 });

    if (!contact.responsavelId) {
      await prisma.contact.update({ where: { id: contact.id }, data: { responsavelId: target } });
      return NextResponse.json({ claimed: true, needsApproval: false });
    }

    if (contact.responsavelId === target) {
      return NextResponse.json({ claimed: true, needsApproval: false, alreadyYours: true });
    }

    // Regra única (lib/lead-claim.ts) — a MESMA que a tela usou pra decidir
    // se mostra "Assumir lead" ou "Solicitar lead" (ver
    // buildConflictPayload). Aqui é a versão de verdade: nunca confia no que
    // a tela achava, decide pelo estado ATUAL no banco. NO_OWNER já saiu
    // acima, então os motivos possíveis aqui são responsável inativo ou
    // lead perdido há mais de 3 meses — nos dois, ninguém precisa aprovar.
    const claim = await evaluateLeadClaim(organizationId, contact.id, contact.responsavelId);

    if (claim.claimReason) {
      const previousOwnerId = contact.responsavelId;
      // prismaRaw.$transaction + setTenantOnTx (não prisma.$transaction) —
      // o client `tx` de uma transação interativa é o cru, sem a extensão
      // de RLS de lib/prisma.ts, então precisa do SET LOCAL manual como 1º
      // passo (ver comentário de setTenantOnTx em lib/tenant-context.ts).
      // Callback, não a forma em array — a forma em array de $transaction
      // não é atômica de verdade neste setup (Prisma 7 + @prisma/adapter-pg,
      // já confirmado antes em scripts/fix-ghost-consultants.ts: uma falha
      // no meio deixava o 1º write já commitado).
      //
      // updateMany com o responsável de quando LEMOS no `where` (trava
      // otimista) — no caso "perdido há +3 meses" o dono ainda está ATIVO e
      // pode reabrir o lead no mesmo instante; sem isso, quem clicou
      // "Assumir" pisaria numa mudança que acabou de acontecer.
      const moved = await prismaRaw.$transaction(async (tx) => {
        await setTenantOnTx(tx, organizationId);
        const result = await tx.contact.updateMany({
          where: { id: contact.id, responsavelId: previousOwnerId },
          data: { responsavelId: target },
        });
        if (result.count === 0) return false;
        await tx.leadRequest.create({
          data: {
            organizationId,
            contactId: contact.id,
            requesterId: userId,
            assigneeId: target,
            ownerId: previousOwnerId,
            status: "APPROVED",
            resolvedAt: new Date(),
            resolvedById: userId,
          },
        });
        return true;
      });
      if (!moved) {
        return NextResponse.json(
          { error: "Este lead acabou de mudar de responsável — atualize e tente de novo." },
          { status: 409 },
        );
      }

      // Dono ATIVO perdendo um lead SEM ter aprovado nada (só o caso "perdido
      // há +3 meses") merece saber — senão o lead some da carteira dele sem
      // explicação. Responsável inativo não tem quem avisar.
      if (claim.claimReason === "LOST_OVER_3_MONTHS") {
        notifyLeadReleased({ contactName: contact.name, assigneeName: targetName, previousOwnerId }).catch((err) =>
          console.error("[lead-requests] falha ao avisar dono anterior", err),
        );
      }
      return NextResponse.json({ claimed: true, needsApproval: false, reason: claim.claimReason });
    }

    // Dono ativo — evita empilhar pedido repetido enquanto o de antes ainda
    // não foi resolvido (ex.: clicou "Solicitar" duas vezes por engano).
    const existingPending = await prisma.leadRequest.findFirst({
      where: { organizationId, contactId: contact.id, requesterId: userId, status: "PENDING" },
    });
    if (existingPending) {
      return NextResponse.json({ claimed: false, needsApproval: true, alreadyRequested: true });
    }

    await prisma.leadRequest.create({
      data: {
        organizationId,
        contactId: contact.id,
        requesterId: userId,
        assigneeId: target,
        ownerId: contact.responsavelId,
        status: "PENDING",
      },
    });

    notifyLeadRequestCreated({
      contactName: contact.name,
      requesterName,
      assigneeName: targetName,
      ownerId: contact.responsavelId,
    }).catch((err) => console.error("[lead-requests] falha ao notificar pedido criado", err));

    return NextResponse.json({ claimed: false, needsApproval: true });
  });
}
