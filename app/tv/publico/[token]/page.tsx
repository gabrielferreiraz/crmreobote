import { requireTvLink } from "@/lib/require-tv-link";
import { getTvMetrics } from "@/lib/tv-dashboard";
import { TvView } from "../../tv-view";

export const dynamic = "force-dynamic";

/**
 * Versão pública (sem login) da TV — pro dispositivo que fica pendurado na
 * parede, que não mantém sessão nenhuma (ver app/tv/page.tsx, que exige
 * requireSession; esta aqui é a irmã pública dela, mesma tela, autenticação
 * diferente). organizationId nunca vem de parâmetro nenhum além do próprio
 * token — requireTvLink resolve ele no banco (hash do token → organização),
 * mesmo cuidado de segurança do resto do app (ver comentário em
 * app/tv/actions.ts).
 *
 * Token revogado/inexistente cai numa tela de erro simples, dentro do MESMO
 * layout escuro (ver ../../layout.tsx) — nunca um redirect pra /login, que
 * não faz sentido nenhum aqui (não tem conta pra logar).
 */
export default async function TvPublicPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { ok, organizationId } = await requireTvLink(token);

  if (!ok || !organizationId) {
    return (
      <div className="flex h-full w-full items-center justify-center text-center">
        <div>
          <p className="text-lg font-semibold text-neutral-200">Link inválido ou revogado</p>
          <p className="mt-1 text-sm text-neutral-500">
            Gere um novo link em Configurações → TV, dentro do CRM.
          </p>
        </div>
      </div>
    );
  }

  const metrics = await getTvMetrics(organizationId);

  return <TvView initialMetrics={metrics} publicToken={token} />;
}
