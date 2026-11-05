import { requireApiKey } from "@/lib/require-api-key";
import { apiError } from "@/lib/api/v1-response";

export async function requirePanelIntegration(req: Request) {
  const access = await requireApiKey(req);
  if (!access.ok) return { ok: false as const, response: apiError("Chave de API inválida ou revogada", 401) };
  const allowedKey = process.env.PAINEL_NICHOS_REASSIGN_API_KEY_ID?.trim();
  if (!allowedKey || access.apiKeyId !== allowedKey) {
    return { ok: false as const, response: apiError("Esta chave não está habilitada para redistribuir negócios pelo Painel Nichos.", 403) };
  }
  return { ok: true as const, access };
}
