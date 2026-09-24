import { NextResponse } from "next/server";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { getSharedScope } from "@/lib/share-groups";
import { recordUserChange } from "@/lib/user-activity";
import type { ProposalActor, ServiceResult } from "./service";

/**
 * Boilerplate comum das rotas de Proposta: sessão + papel, contexto de tenant
 * (RLS) e escopo do usuário calculados num lugar só — nenhuma rota monta isso
 * à mão, então nenhuma consegue esquecer o escopo (ver o comentário de
 * lib/proposals/service.ts sobre por que isso é o ponto sensível).
 *
 * getSharedScope (não getDealScope puro) de propósito: quem compartilha o
 * negócio via grupo (ver lib/share-groups.ts) também pode trabalhar nas
 * propostas dele, mesma regra que atividades já seguem — a autoria de cada
 * ação (createdById/sentById) registra quem de fato fez.
 */
export async function withProposalActor(handler: (actor: ProposalActor) => Promise<NextResponse>): Promise<NextResponse> {
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(access.organizationId, async () => {
    const scope = await getSharedScope(access.organizationId, access.userId, access.role, "shareDeals");
    return handler({ organizationId: access.organizationId, userId: access.userId, scope });
  });
}

/**
 * ServiceResult → resposta HTTP. `mutation: true` registra a alteração no
 * contador diário do usuário (recordUserChange, mesmo que Deal/Task/Contact
 * já fazem) — sem await e com catch, nunca derruba a ação principal por
 * causa de uma contagem de relatório.
 */
export function respond<T>(
  actor: ProposalActor,
  result: ServiceResult<T>,
  opts: { status?: number; mutation?: boolean } = {},
): NextResponse {
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  if (opts.mutation) {
    recordUserChange(actor.organizationId, actor.userId).catch((err) =>
      console.error("[user-activity] falha ao registrar alteração", err),
    );
  }
  return NextResponse.json(result.value, { status: opts.status ?? 200 });
}
