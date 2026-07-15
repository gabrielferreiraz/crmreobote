import { prisma } from "@/lib/prisma";
import { hashApiKey } from "@/lib/api-keys";
import { runWithApiKeyLookup } from "@/lib/tenant-context";

/**
 * Autenticação machine-to-machine pras rotas /api/v1/* — sistema externo não
 * tem cookie de sessão, autentica via `Authorization: Bearer <chave>`.
 * Mesmo contrato de retorno de requireRole/requireSession (ok/organizationId),
 * pra rota continuar dentro de runWithTenant do jeito de sempre.
 */
export async function requireApiKey(req: Request) {
  const header = req.headers.get("authorization");
  const key = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
  if (!key) return { ok: false as const, organizationId: null };

  const keyHash = hashApiKey(key);

  const apiKey = await runWithApiKeyLookup(keyHash, () => prisma.apiKey.findUnique({ where: { keyHash } }));
  if (!apiKey || apiKey.revokedAt) return { ok: false as const, organizationId: null };

  // Fire-and-forget — não atrasa a resposta do integrador por causa de um
  // campo que só serve pra exibir "último uso" na UI de gestão.
  runWithApiKeyLookup(keyHash, () =>
    prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }),
  ).catch(() => {});

  return { ok: true as const, organizationId: apiKey.organizationId, apiKeyId: apiKey.id };
}
