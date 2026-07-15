import { requireApiKey } from "@/lib/require-api-key";
import { runWithTenant } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { apiSuccess, apiError } from "@/lib/api/v1-response";
import { upsertContactFromIntegration } from "@/lib/api/upsert-contact";

export const dynamic = "force-dynamic";

const MAX_BATCH_SIZE = 500;

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
  const contacts = body && typeof body === "object" ? (body as { contacts?: unknown }).contacts : null;
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return apiError("Envie um array não vazio em 'contacts'", 400);
  }
  if (contacts.length > MAX_BATCH_SIZE) {
    return apiError(`Máximo de ${MAX_BATCH_SIZE} contatos por chamada`, 400);
  }

  return runWithTenant(access.organizationId, async () => {
    const results: { index: number; status: "created" | "updated" | "error"; id?: string; error?: string }[] = [];

    for (let index = 0; index < contacts.length; index++) {
      const item = contacts[index];
      if (!item || typeof item !== "object") {
        results.push({ index, status: "error", error: "Item precisa ser um objeto" });
        continue;
      }
      const result = await upsertContactFromIntegration(access.organizationId, item as Record<string, unknown>);
      if (!result.ok) {
        results.push({ index, status: "error", error: result.error });
      } else {
        results.push({ index, status: result.outcome, id: result.contact.id });
      }
    }

    const summary = {
      total: results.length,
      created: results.filter((r) => r.status === "created").length,
      updated: results.filter((r) => r.status === "updated").length,
      errors: results.filter((r) => r.status === "error").length,
    };

    return apiSuccess({ summary, results });
  });
}
