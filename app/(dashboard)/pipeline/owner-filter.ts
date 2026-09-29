/**
 * Filtro combinado "Responsável" do Pipeline (Kanban e Lista, ver
 * kanban-board.tsx/deals-list.tsx) — um único valor de texto guardado no
 * mesmo `ownerFilter` de sempre: "" (todos), o id de uma pessoa (como sempre
 * foi) ou "team:<id>" (equipe inteira — o Supervisor dela + os membros, ver
 * Team.leaderId em lib/team-scope.ts). Pedido explícito do usuário: "mostra
 * equipe: Eduardo, e quando eu clicar filtra o Supervisor e os membros da
 * equipe dele". Sem prefixo pra pessoa de propósito — preserva o valor já
 * persistido (localStorage) de quem usava o filtro antes desta função
 * existir; nenhum id de pessoa (cuid) começa com "team:".
 *
 * Só Supervisor/Gerente/Dono devem VER opção de equipe — decidido em
 * page.tsx (só populam a prop `teams` pra esses papéis); este arquivo não
 * checa papel nenhum, só lida com o valor já filtrado que chegou.
 */
import { sortAlpha } from "@/lib/sort-alpha";

export type TeamOption = { id: string; name: string };
/** Membro tal como as telas do Pipeline já carregam — id/teamId/active bastam pra resolver o filtro. */
export type OwnerFilterMember = { id: string; teamId: string | null; active: boolean };

const TEAM_PREFIX = "team:";

export function teamFilterValue(teamId: string): string {
  return `${TEAM_PREFIX}${teamId}`;
}

function parseTeamFilterId(value: string): string | null {
  return value.startsWith(TEAM_PREFIX) ? value.slice(TEAM_PREFIX.length) : null;
}

/** As opções de equipe do <Select>/<ColumnFilter> de Responsável, em ordem alfabética — vazio quando `teams` vier vazio (ninguém pra listar, ou papel sem permissão). */
export function teamFilterOptions(teams: TeamOption[]): { value: string; label: string }[] {
  return sortAlpha(teams, (t) => t.name).map((t) => ({ value: teamFilterValue(t.id), label: `Equipe: ${t.name}` }));
}

/**
 * `ownerFilter` (+ o filtro companheiro "Ativos e inativos"/"Somente
 * ativos"/"Somente inativos") → o valor final do parâmetro `ownerId` mandado
 * pro back (`?ownerId=a,b,c` — a rota já aceita lista, ver GET
 * app/api/deals/route.ts). null = não filtra por responsável nenhum.
 * `impossibleId` cobre a combinação que não bate com ninguém de verdade (ex.:
 * equipe inteira ativa, mas "Somente inativos" escolhido) — sem isso, uma
 * combinação contraditória caía de volta pra "sem filtro", mostrando negócio
 * que a pessoa não pediu.
 *
 * Reúne numa função só a lógica que kanban-board.tsx e deals-list.tsx
 * reimplementavam cada um por conta própria em 3 ramos quase idênticos (só
 * responsável, só status, os dois juntos) — agora também cobre equipe sem
 * um 4º ramo.
 */
export function resolveOwnerIdParam(
  ownerFilter: string,
  ownerStatusFilter: "" | "active" | "inactive",
  members: OwnerFilterMember[],
  impossibleId: string,
): string | null {
  if (!ownerFilter) {
    if (!ownerStatusFilter) return null;
    const ids = members.filter((m) => (ownerStatusFilter === "active" ? m.active : !m.active)).map((m) => m.id);
    return ids.length > 0 ? ids.join(",") : impossibleId;
  }

  const teamId = parseTeamFilterId(ownerFilter);
  const candidateIds = teamId !== null ? members.filter((m) => m.teamId === teamId).map((m) => m.id) : [ownerFilter];
  if (!ownerStatusFilter) return candidateIds.length > 0 ? candidateIds.join(",") : impossibleId;

  // `?? true` preserva o comportamento de sempre pro caso de um id cru
  // persistido que já não bate com nenhum membro visível hoje (ex.: alguém
  // removido) — trata como "ativo" em vez de sumir sozinho do filtro.
  const byId = new Map(members.map((m) => [m.id, m]));
  const ids = candidateIds.filter((id) => {
    const isActive = byId.get(id)?.active ?? true;
    return ownerStatusFilter === "active" ? isActive : !isActive;
  });
  return ids.length > 0 ? ids.join(",") : impossibleId;
}
