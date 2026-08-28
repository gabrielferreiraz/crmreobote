"use server";

import { headers } from "next/headers";
import { getTvMetrics } from "@/lib/tv-dashboard";
import { requireSession } from "@/lib/require-session";
import { requireTvLink } from "@/lib/require-tv-link";

/**
 * Antes recebia `organizationId` direto do cliente (ver tv-view.tsx, que
 * chama isso a cada 30s pra atualizar a TV sozinha) e confiava nele sem
 * checar nada — qualquer um com sessão (ou nem isso, Server Actions são
 * alcançáveis por qualquer requisição que conheça a rota) podia chamar essa
 * action com o id de OUTRA organização e receber ranking de vendedor,
 * valores fechados e nome de quem vendeu de um concorrente. Hoje isso não
 * vazava nada porque as consultas de dentro de getTvMetrics ainda não
 * tinham `runWithTenant` (RLS bloqueava tudo em silêncio — ver
 * lib/tv-dashboard.ts) — só que corrigir aquilo SEM corrigir isto aqui
 * teria destravado o vazamento de verdade. organizationId agora vem só da
 * sessão de quem está logado nesta aba/TV, nunca de um parâmetro do
 * chamador.
 *
 * `publicCode` (opcional): quem chama a partir do link público (ver
 * app/t/[code]/page.tsx, tv-view.tsx#publicCode) não tem sessão nenhuma —
 * o dispositivo de TV não faz login. Nesse caso resolve organizationId pelo
 * código (requireTvLink, com rate limit por IP) em vez da sessão. Continua
 * sendo o SERVIDOR quem decide qual organização, nunca um id que o cliente
 * mande — mesmo cuidado do parágrafo acima, só que pra uma 2ª origem
 * possível de chamada.
 */
export async function fetchTvMetrics(publicCode?: string) {
  if (publicCode) {
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const { ok, organizationId } = await requireTvLink(publicCode, ip);
    if (!ok || !organizationId) throw new Error("Código inválido ou revogado");
    return await getTvMetrics(organizationId);
  }

  const { organizationId } = await requireSession();
  if (!organizationId) throw new Error("Não autenticado");
  return await getTvMetrics(organizationId);
}
