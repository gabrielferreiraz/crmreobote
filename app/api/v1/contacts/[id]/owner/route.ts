import { prisma, prismaRaw } from "@/lib/prisma";
import { requireApiKey } from "@/lib/require-api-key";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { apiSuccess, apiError } from "@/lib/api/v1-response";
import { contactOwnerInputSchema, firstZodMessage } from "@/lib/api/v1-schemas";
import { evaluateLeadClaim } from "@/lib/lead-claim";
import { logAudit } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

/**
 * Transferência EXPLÍCITA do responsável de um contato já existente — pra
 * integração que precisa repassar a carteira de um lead (ex.: Painel Nichos,
 * fluxo Black Friday, reatribuindo contato de consultor que saiu da
 * empresa), coisa que `contact.ownerId` em POST/PATCH normais NUNCA faz
 * (regra "grudenta" — ver upsertContactFromIntegration em
 * lib/api/upsert-contact.ts): reenvio comum de lead não pode roubar um
 * contato de quem já está cuidando dele.
 *
 * Esta rota existe exatamente pra esse caso excepcional, mas usa a MESMA
 * regra única do resto do CRM (lib/lead-claim.ts, a mesma de "Assumir lead"
 * em POST /api/lead-requests) pra decidir se pode — nunca confia cru no
 * ownerId mandado: só transfere quando o contato está sem responsável, o
 * responsável atual saiu da empresa, ou o lead está perdido há mais de 3
 * meses sem o responsável atual ter mexido nele. Responsável ATIVO com
 * negócio aberto/ganho em andamento nunca é substituído por aqui — a
 * resposta vem com `transferred: false` pra quem chamou saber que precisa
 * de uma decisão humana (dentro do CRM, via "Solicitar lead").
 *
 * Só move `Contact.responsavelId` — `Deal.ownerId` de negócios já criados
 * não é tocado (decisão deliberada: isso já é feito na criação do negócio
 * via `ownerId` de POST /api/v1/deals, direto pra quem a integração já quer).
 *
 * Documentação completa: docs/integracoes-api.md.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiKey(req);
  if (!access.ok) return apiError("Chave de API inválida ou revogada", 401);

  const rateLimited = rateLimitOrResponse(`apikey:${access.apiKeyId}:contact-owner`, 30, 60_000);
  if (rateLimited) return rateLimited;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return apiError("Corpo da requisição precisa ser um objeto JSON", 400);
  }

  const parsed = contactOwnerInputSchema.safeParse(body);
  if (!parsed.success) return apiError(firstZodMessage(parsed.error), 400);
  const { ownerId } = parsed.data;

  return runWithTenant(access.organizationId, async () => {
    const contact = await prisma.contact.findFirst({
      where: { id, organizationId: access.organizationId },
      select: { id: true, name: true, responsavelId: true },
    });
    if (!contact) return apiError("Contato não encontrado", 404);

    const targetMembership = await prisma.organizationUser.findFirst({
      where: { organizationId: access.organizationId, userId: ownerId, active: true },
      select: { user: { select: { id: true, name: true } } },
    });
    if (!targetMembership) {
      return apiError("ownerId não corresponde a um usuário ativo desta organização", 400);
    }
    const target = targetMembership.user;

    if (contact.responsavelId === target.id) {
      return apiSuccess({
        transferred: false,
        reason: "ALREADY_OWNER",
        contact: { id: contact.id, name: contact.name },
        ownerId: target.id,
      });
    }

    const claim = await evaluateLeadClaim(access.organizationId, contact.id, contact.responsavelId);
    if (!claim.claimReason) {
      // Responsável ativo de verdade cuidando do lead — não transfere sem
      // decisão humana (ver comentário da função, mesma regra de "Solicitar
      // lead" dentro do CRM).
      const currentOwner = contact.responsavelId
        ? await prisma.organizationUser.findFirst({
            where: { organizationId: access.organizationId, userId: contact.responsavelId },
            select: { user: { select: { id: true, name: true } } },
          })
        : null;
      return apiSuccess({
        transferred: false,
        reason: "ACTIVE_OWNER",
        contact: { id: contact.id, name: contact.name },
        currentOwnerId: contact.responsavelId,
        currentOwnerName: currentOwner?.user.name ?? null,
      });
    }

    const previousOwnerId = contact.responsavelId;
    // Mesmo padrão de POST /api/lead-requests: trava otimista pelo
    // responsável lido acima — se outra chamada mudou o dono nesse meio
    // tempo, não pisa em cima, devolve 409 pra quem chamou tentar de novo
    // com o estado atual.
    const moved = await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, access.organizationId);
      const result = await tx.contact.updateMany({
        where: { id: contact.id, responsavelId: previousOwnerId },
        data: { responsavelId: target.id },
      });
      return result.count > 0;
    });
    if (!moved) {
      return apiError("Este contato acabou de mudar de responsável — confira o estado atual e tente de novo.", 409);
    }

    await logAudit({
      organizationId: access.organizationId,
      actorName: `API: ${access.apiKeyName}`,
      action: "CONTACT_OWNER_TRANSFERRED",
      targetType: "Contact",
      targetId: contact.id,
      detail: `Responsável transferido de ${previousOwnerId ?? "(sem responsável)"} para ${target.name} (${target.id}) — motivo: ${claim.claimReason}.`,
    });

    return apiSuccess({
      transferred: true,
      reason: claim.claimReason,
      contact: { id: contact.id, name: contact.name },
      previousOwnerId,
      ownerId: target.id,
    });
  });
}
