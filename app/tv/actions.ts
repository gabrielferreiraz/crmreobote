"use server";

import { getTvMetrics } from "@/lib/tv-dashboard";
import { requireSession } from "@/lib/require-session";

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
 */
export async function fetchTvMetrics() {
  const { organizationId } = await requireSession();
  if (!organizationId) throw new Error("Não autenticado");
  return await getTvMetrics(organizationId);
}
