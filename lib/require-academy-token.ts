/**
 * Autenticação das rotas de DADOS /api/academy/{me,progresso,progresso/me}
 * (chamadas servidor→servidor pela Reobote Academy, nunca pelo navegador) —
 * mesmo contrato de retorno (ok/organizationId/...) de requireRole/
 * requireApiKey/requireTvLink, pra rota continuar dentro de runWithTenant
 * do jeito de sempre.
 *
 * O access_token é OPACO (não é mais um JWT — ver lib/academy-oauth.ts):
 * verificar é procurar o HASH dele em AcademyAccessToken, não decodificar
 * assinatura nenhuma. Localizável por hash ANTES de se conhecer
 * organizationId via runWithAcademyCredentialLookup (mesmo bootstrap de RLS
 * que ApiKey/TvDisplayLink já usam, ver lib/tenant-context.ts).
 *
 * NOTA (item "middleware" do pedido original da Academy): este projeto usa
 * `proxy.ts` (next-auth) como middleware de fato, e ele já EXCLUI `/api` do
 * próprio matcher — rota de API não passa por middleware nenhum aqui.
 * "Middleware de autenticação" pras rotas da Academy é isto: uma função
 * chamada explicitamente no topo de cada route handler, mesma convenção já
 * usada pra toda autenticação alternativa do sistema.
 *
 * Reconfirma SEMPRE em banco (nunca confia só no `userId`/`role` gravados
 * no momento em que o token foi emitido) — mesmo cuidado de
 * getCurrentMembership: uma desativação ou troca de papel precisa valer na
 * PRÓXIMA chamada da Academy, não só quando o access_token de 15min expirar
 * sozinho.
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant, runWithAcademyCredentialLookup } from "@/lib/tenant-context";
import { mapOrgRoleToAcademyRole, hashReceivedSecret, type AcademyRole } from "@/lib/academy-oauth";

export type AcademyAccess =
  | { ok: true; organizationId: string; userId: string; role: AcademyRole; name: string; email: string }
  | { ok: false; status: 401; error: string };

const INVALID = { ok: false as const, status: 401 as const, error: "Token inválido ou expirado" };

export async function requireAcademyToken(req: Request): Promise<AcademyAccess> {
  const header = req.headers.get("authorization");
  const accessToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
  if (!accessToken) return INVALID;

  const tokenHash = hashReceivedSecret(accessToken);

  const record = await runWithAcademyCredentialLookup(tokenHash, () =>
    prisma.academyAccessToken.findUnique({
      where: { tokenHash },
      select: { organizationId: true, userId: true, expiresAt: true, revokedAt: true },
    }),
  );
  if (!record || record.revokedAt || record.expiresAt <= new Date()) return INVALID;

  const { organizationId, userId } = record;

  // Confirma no banco que o vínculo ainda existe e está ATIVO, e recalcula o
  // papel AGORA — nunca o que valia no instante em que o token foi emitido
  // (ver comentário no topo do arquivo).
  const membership = await runWithTenant(organizationId, () =>
    prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { active: true, role: true, user: { select: { name: true, email: true } } },
    }),
  );
  if (!membership || !membership.active) return INVALID;

  return {
    ok: true,
    organizationId,
    userId,
    role: mapOrgRoleToAcademyRole(membership.role),
    name: membership.user.name,
    email: membership.user.email,
  };
}
