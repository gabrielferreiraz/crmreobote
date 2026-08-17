import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/require-api-key";
import { runWithTenant } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { apiSuccess, apiError } from "@/lib/api/v1-response";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { dealNoteInputSchema, firstZodMessage } from "@/lib/api/v1-schemas";

export const dynamic = "force-dynamic";

/**
 * Anexa uma nota à descrição de um negócio já existente — nunca sobrescreve
 * o que já tinha, concatena numa linha nova com data/hora na frente.
 * Pensado pro fluxo de agendamento da landing page: o negócio já foi criado
 * por POST /api/v1/deals com a descrição de sempre, e só depois, na tela de
 * agendamento, se nenhum horário de GET /api/v1/availability servir, o lead
 * escreve um horário preferido em texto livre — isso não é um agendamento
 * de verdade (não cria Task nem mexe em POST /api/v1/appointments), só um
 * registro na descrição pro consultor ver e ligar combinando um horário.
 * Um único campo de propósito (`note`) — não é uma edição geral do negócio.
 * Documentação completa: docs/integracoes-api.md.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiKey(req);
  if (!access.ok) return apiError("Chave de API inválida ou revogada", 401);

  const rateLimited = rateLimitOrResponse(`apikey:${access.apiKeyId}:deals-note`, 30, 60_000);
  if (rateLimited) return rateLimited;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return apiError("Corpo da requisição precisa ser um objeto JSON", 400);
  }

  const parsed = dealNoteInputSchema.safeParse(body);
  if (!parsed.success) return apiError(firstZodMessage(parsed.error), 400);

  return runWithTenant(access.organizationId, async () => {
    const deal = await prisma.deal.findFirst({
      where: { id, organizationId: access.organizationId },
      select: { id: true, description: true },
    });
    if (!deal) return apiError("Negócio não encontrado", 404);

    const timestamp = new Date().toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Campo_Grande",
    });
    const noteLine = `[${timestamp}] ${sanitizeCell(parsed.data.note)}`;
    const description = deal.description ? `${deal.description}\n\n${noteLine}` : noteLine;

    const updated = await prisma.deal.update({
      where: { id: deal.id },
      data: { description },
      select: { id: true, description: true },
    });

    return apiSuccess({ id: updated.id, description: updated.description });
  });
}
