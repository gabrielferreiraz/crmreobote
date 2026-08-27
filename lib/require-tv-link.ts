import { prisma } from "@/lib/prisma";
import { hashTvDisplayLinkToken } from "@/lib/tv-display-link";
import { runWithTvLinkLookup } from "@/lib/tenant-context";

/**
 * Autenticação do link público (sem login) da TV — app/tv/publico/[token]/
 * (a página em si) e app/tv/actions.ts (o polling que ela dispara a cada
 * 15s) chamam isto em vez de requireSession. Mesmo contrato de retorno
 * (ok/organizationId) que requireSession/requireApiKey, pra quem chama
 * continuar dentro de runWithTenant do jeito de sempre depois.
 */
export async function requireTvLink(token: string) {
  const tokenHash = hashTvDisplayLinkToken(token);

  const link = await runWithTvLinkLookup(tokenHash, () => prisma.tvDisplayLink.findUnique({ where: { tokenHash } }));
  if (!link || link.revokedAt) return { ok: false as const, organizationId: null };

  // Fire-and-forget — não atrasa a TV por causa de um campo que só serve
  // pra exibir "último uso" na UI de gestão (mesmo padrão de
  // lib/require-api-key.ts).
  runWithTvLinkLookup(tokenHash, () =>
    prisma.tvDisplayLink.update({ where: { id: link.id }, data: { lastUsedAt: new Date() } }),
  ).catch(() => {});

  return { ok: true as const, organizationId: link.organizationId };
}
