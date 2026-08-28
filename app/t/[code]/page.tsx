import { headers } from "next/headers";
import { requireTvLink } from "@/lib/require-tv-link";
import { getTvMetrics } from "@/lib/tv-dashboard";
import { TvShell } from "@/components/tv-shell";
import { TvView } from "../../tv/tv-view";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "TV Dashboard",
};

/**
 * Versão pública (sem login) da TV — pro dispositivo que fica pendurado na
 * parede, que não mantém sessão nenhuma (ver app/tv/page.tsx, que exige
 * requireSession; esta aqui é a irmã pública dela, mesma tela, autenticação
 * diferente). Rota no nível RAIZ do site (`/t/CÓDIGO`, não `/tv/p/CÓDIGO`
 * nem `/tv/publico/CÓDIGO`) — pedido explícito de deixar o link inteiro (não
 * só o código) o mais curto possível de digitar num controle remoto; cada
 * segmento de caminho é mais alguns cliques de seta + OK numa tela na
 * parede. Fica fora de app/tv/* de propósito, então não herda
 * app/tv/layout.tsx — usa TvShell (components/tv-shell.tsx) direto, a MESMA
 * moldura visual, só chamada explicitamente aqui.
 *
 * organizationId nunca vem de parâmetro nenhum além do próprio código —
 * requireTvLink resolve ele no banco (hash do código → organização), mesmo
 * cuidado de segurança do resto do app (ver comentário em app/tv/actions.ts).
 * Código errado/revogado cai numa tela de erro simples, dentro da MESMA
 * moldura escura — nunca um redirect pra /login, que não faz sentido nenhum
 * aqui (não tem conta pra logar).
 */
export default async function TvPublicPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { ok, organizationId } = await requireTvLink(code, ip);

  if (!ok || !organizationId) {
    return (
      <TvShell>
        <div className="flex h-full w-full items-center justify-center text-center">
          <div>
            <p className="text-lg font-semibold text-neutral-200">Código inválido ou revogado</p>
            <p className="mt-1 text-sm text-neutral-500">
              Gere um novo código em Configurações → TV, dentro do CRM.
            </p>
          </div>
        </div>
      </TvShell>
    );
  }

  const metrics = await getTvMetrics(organizationId);

  return (
    <TvShell>
      <TvView initialMetrics={metrics} publicCode={code} />
    </TvShell>
  );
}
