import { requireApiKey } from "@/lib/require-api-key";
import { apiError } from "@/lib/api/v1-response";

export async function requirePanelIntegration(req: Request) {
  const access = await requireApiKey(req);
  if (!access.ok) return { ok: false as const, response: apiError("Chave de API inválida ou revogada", 401) };
  return { ok: true as const, access };
}
