import { requireApiKey } from "@/lib/require-api-key";
import { runWithTenant } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { apiSuccess, apiError } from "@/lib/api/v1-response";
import { upsertContactFromIntegration } from "@/lib/api/upsert-contact";

export const dynamic = "force-dynamic";

/**
 * Ingestão de 1 lead/contato por chamada, autenticado por API key
 * (Authorization: Bearer <chave>) — pensado pra Make/Zapier/gerador de leads.
 * Cria ou atualiza por telefone/whatsapp (nunca 409 de duplicata — ver
 * lib/api/upsert-contact.ts). Documentação completa: docs/integracoes-api.md.
 */
export async function POST(req: Request) {
  const access = await requireApiKey(req);
  if (!access.ok) return apiError("Chave de API inválida ou revogada", 401);

  const rateLimited = rateLimitOrResponse(`apikey:${access.apiKeyId}:contacts`, 60, 60_000);
  if (rateLimited) return rateLimited;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return apiError("Corpo da requisição precisa ser um objeto JSON", 400);
  }

  return runWithTenant(access.organizationId, async () => {
    const result = await upsertContactFromIntegration(access.organizationId, body as Record<string, unknown>);
    if (!result.ok) return apiError(result.error, 400);

    const c = result.contact;
    return apiSuccess(
      {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        whatsapp: c.whatsapp,
        source: c.source,
        company: c.company,
        jobTitle: c.jobTitle,
        address: c.address,
        addressNumber: c.addressNumber,
        addressComplement: c.addressComplement,
        neighborhood: c.neighborhood,
        city: c.city,
        state: c.state,
        zipCode: c.zipCode,
        tags: c.tags,
        ownerId: c.responsavelId,
        customFields: c.customFields,
        createdAt: c.createdAt,
        outcome: result.outcome,
        warnings: result.warnings,
      },
      result.outcome === "created" ? 201 : 200,
    );
  });
}
