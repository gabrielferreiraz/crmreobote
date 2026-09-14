import { prisma } from "@/lib/prisma";
import { runWithCardSlugLookup } from "@/lib/tenant-context";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Autenticação da página pública do Cartão Digital (app/c/[slug]/) — mesmo
 * contrato de retorno (ok/organizationId) que requireTvLink/requireApiKey,
 * pra quem chama continuar dentro de runWithTenant do jeito de sempre
 * depois de resolver quem é o dono do slug. Devolve só organizationId/
 * cardId (linha mínima, ver comentário em getCardRowBySlug) — quem chama
 * troca pra runWithTenant(organizationId, ...) e busca o resto (user,
 * links) com getCardDetails, já com RLS normal funcionando.
 *
 * Diferente do link da TV, slug NÃO é secreto (é feito pra ser
 * compartilhado) — o rate limit aqui existe só como proteção genérica
 * contra scraping/abuso (bater a rota MUITAS vezes rápido), não como defesa
 * contra adivinhação de token. Limite bem mais folgado que o da TV.
 */
export async function requireDigitalCard(slug: string, ip: string) {
  const rl = rateLimit(`digital-card:${ip}`, 120, 5 * 60 * 1000);
  if (!rl.allowed) return { ok: false as const, organizationId: null, cardId: null };

  const row = await runWithCardSlugLookup(slug, () => prisma.digitalCard.findUnique({ where: { slug } }));
  if (!row || !row.active) return { ok: false as const, organizationId: null, cardId: null };

  return { ok: true as const, organizationId: row.organizationId, cardId: row.id };
}
