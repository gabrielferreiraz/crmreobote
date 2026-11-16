import { z } from "zod";
import { runWithTenant } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { apiSuccess, apiError } from "@/lib/api/v1-response";
import { requirePanelIntegration } from "@/lib/api/painel-access";
import { upsertContactFromIntegration } from "@/lib/api/upsert-contact";
import { contactInputSchema, firstZodMessage } from "@/lib/api/v1-schemas";

export const dynamic = "force-dynamic";

/**
 * Lista de nicho do Painel: contatos novos para um consultor. Mesmo tratamento do envio em lote
 * (/api/v1/contacts/bulk), com lotes pequenos e limite próprio, para uma lista de 100+ leads
 * não esbarrar no limite do lote genérico nem no tempo da chamada.
 */
const MAX_CONTACTS = 50;
const panelContactsSchema = z.object({ contacts: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_CONTACTS) });

export async function POST(req: Request) {
  const auth = await requirePanelIntegration(req);
  if (!auth.ok) return auth.response;
  const { access } = auth;

  const rateLimited = rateLimitOrResponse(`apikey:${access.apiKeyId}:painel-contacts`, 120, 60_000);
  if (rateLimited) return rateLimited;

  const parsedBatch = panelContactsSchema.safeParse(await req.json().catch(() => null));
  if (!parsedBatch.success) return apiError(firstZodMessage(parsedBatch.error), 400);

  return runWithTenant(access.organizationId, async () => {
    const results: { index: number; status: "created" | "updated" | "error"; id?: string; error?: string; warnings?: string[] }[] = [];
    for (const [index, item] of parsedBatch.data.contacts.entries()) {
      const parsedItem = contactInputSchema.safeParse(item);
      if (!parsedItem.success) { results.push({ index, status: "error", error: firstZodMessage(parsedItem.error) }); continue; }
      try {
        const result = await upsertContactFromIntegration(access.organizationId, parsedItem.data);
        results.push(result.ok
          ? { index, status: result.outcome, id: result.contact.id, ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}) }
          : { index, status: "error", error: result.error });
      } catch {
        // Um contato com problema não derruba os outros do lote.
        results.push({ index, status: "error", error: "Não foi possível gravar este contato." });
      }
    }
    return apiSuccess({
      summary: {
        total: results.length,
        created: results.filter(r => r.status === "created").length,
        updated: results.filter(r => r.status === "updated").length,
        errors: results.filter(r => r.status === "error").length,
      },
      results,
    });
  });
}
