import { requireApiKey } from "@/lib/require-api-key";
import { runWithTenant } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { apiSuccess, apiError } from "@/lib/api/v1-response";
import { upsertContactFromIntegration } from "@/lib/api/upsert-contact";
import { bulkContactsSchema, contactInputSchema, firstZodMessage } from "@/lib/api/v1-schemas";

export const dynamic = "force-dynamic";

/**
 * Ingestão em lote (lista fria) — mesmo formato de item de POST /api/v1/contacts,
 * processado em sequência (upsert por linha, não createMany — precisa de
 * upsert e relatório por item, não só criar ignorando duplicata).
 */
export async function POST(req: Request) {
  const access = await requireApiKey(req);
  if (!access.ok) return apiError("Chave de API inválida ou revogada", 401);

  const rateLimited = rateLimitOrResponse(`apikey:${access.apiKeyId}:contacts-bulk`, 10, 60_000);
  if (rateLimited) return rateLimited;

  const body = await req.json().catch(() => null);
  const parsedBatch = bulkContactsSchema.safeParse(body);
  if (!parsedBatch.success) return apiError(firstZodMessage(parsedBatch.error), 400);
  const { contacts } = parsedBatch.data;

  return runWithTenant(access.organizationId, async () => {
    const results: {
      index: number;
      status: "created" | "updated" | "error";
      id?: string;
      error?: string;
      warnings?: string[];
    }[] = [];

    for (let index = 0; index < contacts.length; index++) {
      const item = contacts[index];
      const parsedItem = contactInputSchema.safeParse(item);
      if (!parsedItem.success) {
        results.push({ index, status: "error", error: firstZodMessage(parsedItem.error) });
        continue;
      }
      const result = await upsertContactFromIntegration(access.organizationId, parsedItem.data);
      if (!result.ok) {
        results.push({ index, status: "error", error: result.error });
      } else {
        results.push({
          index,
          status: result.outcome,
          id: result.contact.id,
          ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
        });
      }
    }

    const summary = {
      total: results.length,
      created: results.filter((r) => r.status === "created").length,
      updated: results.filter((r) => r.status === "updated").length,
      errors: results.filter((r) => r.status === "error").length,
      warnings: results.filter((r) => (r.warnings?.length ?? 0) > 0).length,
    };

    return apiSuccess({ summary, results });
  });
}
