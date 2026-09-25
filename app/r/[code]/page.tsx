import { headers } from "next/headers";
import { requireTvLink } from "@/lib/require-tv-link";
import { getTvRanking } from "@/lib/tv-dashboard";
import { TvShell } from "@/components/tv-shell";
import { TvRankingView } from "../../tv/ranking-view";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Ranking do mês",
};

/**
 * Versão pública (sem login) da tela do Ranking do mês — pro aparelho de TV
 * INTERNA, que não mantém sessão (mesma razão de app/t/[code]/page.tsx, a
 * irmã que mostra o dashboard principal). Rota no nível raiz e curta ("/r/
 * CÓDIGO") pelo mesmo motivo daquela: o endereço inteiro precisa ser fácil de
 * digitar num controle remoto.
 *
 * O código aqui é do tipo RANKING, gerado à parte em Configurações → TV — o
 * do dashboard principal (tipo DASHBOARD) NÃO abre esta tela (ver
 * requireTvLink em lib/require-tv-link.ts). Esse é o ponto de tudo isto: quem
 * só tem o código da TV que cliente enxerga nunca chega no ranking.
 *
 * Fica fora de app/tv/* de propósito (não herda app/tv/layout.tsx) e usa
 * TvShell direto, igual a app/t/[code]/page.tsx. Código errado/revogado cai
 * numa tela de erro simples, dentro da mesma moldura escura — nunca um
 * redirect pra /login, que não faz sentido aqui (não tem conta pra logar).
 */
export default async function TvRankingPublicPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { ok, organizationId } = await requireTvLink(code, ip, "RANKING");

  if (!ok || !organizationId) {
    return (
      <TvShell>
        <div className="flex h-full w-full items-center justify-center text-center">
          <div>
            <p className="text-lg font-semibold text-neutral-200">Código inválido ou revogado</p>
            <p className="mt-1 text-sm text-neutral-500">
              Gere um novo código do Ranking em Configurações → TV, dentro do CRM.
            </p>
          </div>
        </div>
      </TvShell>
    );
  }

  const data = await getTvRanking(organizationId);

  return (
    <TvShell>
      <TvRankingView initialData={data} publicCode={code} />
    </TvShell>
  );
}
