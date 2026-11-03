import { ListChecks } from "lucide-react";

/**
 * Entrada do Painel de Nichos pelo cabeçalho, já logado.
 *
 * É um link de NAVEGAÇÃO, não um fetch: GET /api/painel-nichos-sso assina um
 * token e responde 307 para o Painel de Nichos com ele na query string (ver
 * app/api/painel-nichos-sso/route.ts). Quem tem que seguir esse redirect é o
 * navegador — é ele que precisa acabar no outro domínio e receber lá o cookie
 * de sessão. Um fetch seguiria o redirect dentro da página, guardaria a
 * resposta e ninguém sairia do lugar: a pessoa continuaria no CRM e não
 * estaria logada em lugar nenhum.
 *
 * Aba nova (como o Simulador ao lado): o CRM continua aberto atrás.
 */
export function PainelNichosButton({ compact = false }: { compact?: boolean }) {
  return (
    <a
      href="/api/painel-nichos-sso"
      target="_blank"
      rel="noopener noreferrer"
      className="btn-secondary btn-sm shrink-0"
      aria-label={compact ? "Painel de Nichos" : undefined}
      title="Painel de Nichos"
    >
      <ListChecks className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      {!compact && "Nichos"}
    </a>
  );
}
