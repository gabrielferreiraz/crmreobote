import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { getSharedScope } from "@/lib/share-groups";
import { dealScopeWhere } from "@/lib/deals/split";
import { computeDealShares, validateSplit, type SplitParticipantInput } from "@/lib/deals/split-shares";
import { applyDealSplitToSaleTx, withCommissionLock } from "@/lib/commissions/sync";
import { recordUserChange } from "@/lib/user-activity";
import { sendPushToUser } from "@/lib/push";
import { readJsonObjectOrError } from "@/lib/read-body";

export const dynamic = "force-dynamic";

/**
 * Divisão do negócio entre responsáveis (ver lib/deals/split.ts) — o
 * responsável PRINCIPAL define quem divide e quanto cada co-responsável leva;
 * o que sobra é dele. Troca a lista INTEIRA de uma vez (a soma nunca fica
 * pela metade) e, se o negócio já foi ganho, atualiza a comissão na MESMA
 * transação — com parcela de vendedor já paga, recusa antes de mexer em
 * qualquer coisa.
 *
 * Só o responsável principal mexe aqui (decisão do dono do sistema, 10/2026):
 * nem co-responsável, nem gerente — pra dividir por ele o gerente passa o
 * negócio pra si antes (ver PUT /api/deals/[id], que já faz isso).
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const body = await readJsonObjectOrError(req);
  if (body instanceof NextResponse) return body;
  const rawList = body.participants;
  if (!Array.isArray(rawList)) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const participants: SplitParticipantInput[] = [];
  for (const item of rawList) {
    const record = item as Record<string, unknown> | null;
    if (!record || typeof record.userId !== "string" || typeof record.sharePercent !== "number") {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    participants.push({ userId: record.userId, sharePercent: record.sharePercent });
  }

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { organizationId, userId } = access;

  return runWithTenant(organizationId, async () => {
    const scope = await getSharedScope(organizationId, userId, access.role, "shareDeals");
    const deal = await prisma.deal.findFirst({
      where: { id, organizationId, ...dealScopeWhere(scope) },
      select: { id: true, name: true, ownerId: true, status: true },
    });
    if (!deal) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    if (deal.ownerId !== userId) {
      return NextResponse.json({ error: "Só o responsável principal pode mudar a divisão do negócio." }, { status: 403 });
    }

    const valid = validateSplit(deal.ownerId, participants);
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });

    const wantedIds = participants.map((p) => p.userId);
    if (wantedIds.length > 0) {
      const members = await prisma.organizationUser.findMany({
        where: { organizationId, active: true, userId: { in: wantedIds } },
        select: { userId: true },
      });
      if (members.length !== wantedIds.length) {
        return NextResponse.json({ error: "Escolha só pessoas ativas da equipe." }, { status: 400 });
      }
    }

    const before = await prisma.dealParticipant.findMany({ where: { dealId: id }, select: { userId: true } });
    const beforeIds = new Set(before.map((b) => b.userId));

    // Negócio ganho: grava a divisão E refaz a comissão sob a trava de comissão
    // (uma transação só). Ainda não ganho: transação comum.
    const write = async (tx: Parameters<Parameters<typeof prismaRaw.$transaction>[0]>[0]) => {
      await tx.dealParticipant.deleteMany({ where: { dealId: id, userId: { notIn: wantedIds } } });
      for (const p of participants) {
        await tx.dealParticipant.upsert({
          where: { dealId_userId: { dealId: id, userId: p.userId } },
          update: { sharePercent: p.sharePercent },
          create: { organizationId, dealId: id, userId: p.userId, sharePercent: p.sharePercent, addedById: userId },
        });
      }
    };

    let failure: string | null = null;
    if (deal.status === "WON") {
      await withCommissionLock(organizationId, async (tx) => {
        await write(tx);
        const result = await applyDealSplitToSaleTx(tx, organizationId, id);
        if (!result.ok) {
          failure = result.error;
          // Desfaz a gravação acima: a divisão do negócio nunca fica diferente da comissão.
          throw new SplitRejected(result.error);
        }
      }).catch((err) => {
        if (!(err instanceof SplitRejected)) throw err;
      });
    } else {
      await prismaRaw.$transaction(async (tx) => {
        await setTenantOnTx(tx, organizationId);
        await write(tx);
      });
    }
    if (failure) return NextResponse.json({ error: failure }, { status: 409 });

    const shares = computeDealShares(deal.ownerId, participants);
    const people = await prisma.user.findMany({
      where: { id: { in: shares.map((s) => s.userId) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(people.map((p) => [p.id, p.name]));

    const summary =
      participants.length === 0
        ? "tirou a divisão do negócio (responsável único)"
        : `dividiu o negócio: ${shares.map((s) => `${nameOf.get(s.userId) ?? "?"} ${s.percent}%`).join(", ")}`;
    await prisma.activity.create({
      data: { organizationId, dealId: id, userId, type: "SYSTEM", body: summary },
    });
    recordUserChange(organizationId, userId).catch((err) => console.error("[user-activity] falha ao registrar alteração", err));

    // Quem acabou de entrar fica sabendo (o negócio aparece no Pipeline dele, mas ninguém vê isso sozinho).
    for (const p of participants.filter((x) => !beforeIds.has(x.userId))) {
      sendPushToUser(p.userId, {
        title: "Negócio dividido com você",
        body: `${nameOf.get(userId) ?? "Alguém"} te colocou no negócio "${deal.name}" (${p.sharePercent}%)`,
        url: `/negocios/${id}`,
      }).catch((err) => console.error("[deal-split] falha ao mandar push", err));
    }

    return NextResponse.json({
      shares: shares.map((s) => ({ ...s, name: nameOf.get(s.userId) ?? "" })),
    });
  });
}

class SplitRejected extends Error {}
