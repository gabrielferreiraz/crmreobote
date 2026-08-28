import { prisma } from "@/lib/prisma";
import { hashTvDisplayLinkCode, normalizeTvDisplayLinkCode } from "@/lib/tv-display-link";
import { runWithTvLinkLookup } from "@/lib/tenant-context";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Autenticação do link público (sem login) da TV — app/t/[code]/ (a
 * página em si) e app/tv/actions.ts (o polling que ela dispara a cada 15s)
 * chamam isto em vez de requireSession. Mesmo contrato de retorno
 * (ok/organizationId) que requireSession/requireApiKey, pra quem chama
 * continuar dentro de runWithTenant do jeito de sempre depois.
 *
 * `ip` é obrigatório — o código é curto de propósito (fácil de digitar no
 * controle da TV, ver lib/tv-display-link.ts), então a 2ª camada de defesa
 * contra tentativa de adivinhação é limitar quantas tentativas cada IP pode
 * fazer, não só a entropia do código em si. 60 tentativas/5min é bem folgado
 * pra uso legítimo (uma TV só faz 1 a cada 15s = 20/5min, sobra margem pra
 * F5 manual no meio) e inviabiliza forçar um código de 60 bits de entropia
 * na prática.
 */
export async function requireTvLink(rawCode: string, ip: string) {
  const rl = rateLimit(`tv-link:${ip}`, 60, 5 * 60 * 1000);
  if (!rl.allowed) return { ok: false as const, organizationId: null };

  const code = normalizeTvDisplayLinkCode(rawCode);
  const codeHash = hashTvDisplayLinkCode(code);

  const link = await runWithTvLinkLookup(codeHash, () => prisma.tvDisplayLink.findUnique({ where: { tokenHash: codeHash } }));
  if (!link || link.revokedAt) return { ok: false as const, organizationId: null };

  // Fire-and-forget — não atrasa a TV por causa de um campo que só serve
  // pra exibir "último uso" na UI de gestão (mesmo padrão de
  // lib/require-api-key.ts).
  runWithTvLinkLookup(codeHash, () =>
    prisma.tvDisplayLink.update({ where: { id: link.id }, data: { lastUsedAt: new Date() } }),
  ).catch(() => {});

  return { ok: true as const, organizationId: link.organizationId };
}
