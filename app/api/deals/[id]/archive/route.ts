import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { runWithTenant } from "@/lib/tenant-context";
import { logAudit } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

/**
 * Arquivar / desarquivar um negócio.
 *
 * Arquivar NÃO apaga nada: só preenche `Deal.archivedAt` (ver schema.prisma),
 * e com isso o negócio sai do Kanban, da Lista, da busca e da exportação —
 * todas passam por buildDealsWhere (lib/deals/list-query.ts), que esconde
 * arquivado por padrão. Voltar atrás é o mesmo endpoint com
 * `{ archived: false }`, direto da lista de arquivados do Pipeline.
 *
 * Permissão: getDealScope PURO, igual ao DELETE do negócio (ver
 * app/api/deals/[id]/route.ts) e de propósito NÃO getSharedScope — arquivar
 * some com o negócio para a organização inteira, então quem só recebeu o
 * negócio por compartilhamento de grupo (acesso colaborativo) não decide
 * isso. Dentro do próprio escopo qualquer papel pode, inclusive MEMBER: é
 * reversível por qualquer um que enxergue o negócio e fica na auditoria.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { archived?: unknown };
  // Só aceita booleano explícito — "arquivar" e "desarquivar" são ações
  // opostas sobre um negócio de outra pessoa; um corpo malformado não pode
  // cair num padrão silencioso.
  if (typeof body.archived !== "boolean") {
    return NextResponse.json({ error: "Informe archived: true ou false" }, { status: 400 });
  }
  const archived = body.archived;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(access.organizationId, async () => {
    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    const existing = await prisma.deal.findFirst({
      where: { id, organizationId: access.organizationId, ...scopeWhere(scope) },
      select: { id: true, name: true, archivedAt: true },
    });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    // Idempotente: arquivar o que já está arquivado (dois cliques, duas abas)
    // responde ok sem regravar a data — senão o "arquivado em" da lista
    // pularia para agora sem ninguém ter feito nada.
    if (archived === !!existing.archivedAt) {
      return NextResponse.json({ ok: true, archived });
    }

    const deal = await prisma.deal.update({
      where: { id },
      data: archived
        ? { archivedAt: new Date(), archivedById: access.userId }
        : { archivedAt: null, archivedById: null },
      select: { id: true, name: true, archivedAt: true },
    });

    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.session?.user?.name ?? "Usuário",
      action: archived ? "DEAL_ARCHIVED" : "DEAL_UNARCHIVED",
      targetType: "Deal",
      targetId: id,
      detail: existing.name,
    });

    return NextResponse.json({ ok: true, archived: !!deal.archivedAt });
  });
}
