import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveAvatarUrlMap } from "@/lib/r2";
import { brazilStartOfMonth, brazilStartOfYear, getBrazilParts } from "@/lib/timezone";
import { SERVER_INSTANCE_ID } from "@/lib/server-instance";

export async function getTvConfig(organizationId: string) {
  try {
    // Sem isso, toda consulta abaixo roda sem `app.current_organization_id`
    // definido — a policy de RLS de PipelineStage (bem como Deal/MonthlyGoal
    // em getTvMetrics, mais abaixo) então filtra tudo em silêncio, zero linha
    // devolvida, sem erro nenhum (ver comentário em lib/prisma.ts). Era esse
    // wrap que faltava aqui: a tela de Configurações da TV mostrava "Nenhuma
    // etapa encontrada" mesmo a organização tendo etapas de verdade.
    return await runWithTenant(organizationId, async () => {
      const config = await prisma.tvDashboardConfig.findUnique({
        where: { organizationId },
      });

      return {
        id: config?.id || "",
        organizationId,
        adsUrls: (config?.adsUrls as string[]) || [],
        churrascometroTarget: config?.churrascometroTarget || 0,
        selectedStageIds: (config?.selectedStageIds as string[]) || [],
        visibleWidgets: (config?.visibleWidgets as string[]) || ["sales_summary","churrascometro","last_sale","funnels","ranking"],
      };
    });
  } catch (error) {
    console.error("[getTvConfig] Error:", error);
    return {
      id: "",
      organizationId,
      adsUrls: [],
      churrascometroTarget: 0,
      selectedStageIds: [],
      visibleWidgets: ["sales_summary","churrascometro","last_sale","funnels","ranking"],
    };
  }
}

export async function getTvMetrics(organizationId: string) {
  const now = new Date();
  // Sempre calendário de Brasília, nunca o do servidor (container roda em
  // UTC — ver o aviso no topo de lib/timezone.ts). Antes isso usava
  // date-fns puro (startOfMonth/endOfMonth/startOfYear/endOfYear) direto em
  // cima de `now`, ou seja, no fuso do SERVIDOR: o mês virava (e o
  // Churrascômetro zerava) 3h mais cedo do que a meia-noite real de
  // Brasília, e nas primeiras 3h de cada mês novo (00h-03h em Brasília) a
  // consulta ainda considerava o mês ANTERIOR como o atual.
  //
  // Sem limite superior nas consultas abaixo de propósito — `gte: início do
  // mês/ano` já é suficiente pra "até agora" (não existe negócio com
  // closedAt no futuro), mesmo padrão que getCurrentMonthGoalProgress
  // (lib/goals/suggestion.ts) e o KPI "Fechado no mês" de Relatórios já usam.
  const monthStart = brazilStartOfMonth(now);
  const yearStart = brazilStartOfYear(now);
  const nowParts = getBrazilParts(now);

  const config = await getTvConfig(organizationId);
  const selectedStageIds = config.selectedStageIds;

  try {
    // Mesmo motivo do wrap em getTvConfig acima: Deal/MonthlyGoal/PipelineStage
    // têm RLS forçada — sem `runWithTenant`, toda consulta abaixo voltava
    // vazia em silêncio (zero venda, zero ranking, zero lead no funil), a TV
    // de verdade (não só a tela de configuração) ficava sempre zerada.
    return await runWithTenant(organizationId, async () => {
      // 1. Ranking Empresas (Top 3 users this month)
      const wonDealsThisMonth = await prisma.deal.findMany({
        where: {
          organizationId,
          status: "WON",
          closedAt: { gte: monthStart },
        },
        select: {
          ownerId: true,
          value: true,
          owner: { select: { name: true, image: true } },
        },
      });

      const salesByUser = new Map<string, { id: string; name: string; image: string | null; total: number }>();
      for (const deal of wonDealsThisMonth) {
        if (!deal.ownerId || !deal.owner) continue;
        const existing = salesByUser.get(deal.ownerId) || {
          id: deal.ownerId,
          name: deal.owner.name,
          image: deal.owner.image,
          total: 0,
        };
        existing.total += Number(deal.value || 0);
        salesByUser.set(deal.ownerId, existing);
      }

      const rankingRaw = Array.from(salesByUser.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 3);

      const totalVendasMes = wonDealsThisMonth.reduce((acc, curr) => acc + Number(curr.value || 0), 0);

      // 2. Última venda — id e closedAt junto pra tv-view.tsx saber DE
      // VERDADE quando é uma venda nova (não só "o valor mudou", que também
      // aconteceria se o MESMO negócio fosse reaberto/editado) e disparar a
      // comemoração de confete só nesse caso, nunca a cada refresh (ver
      // METRICS_POLL_MS em tv-view.tsx).
      const lastSale = await prisma.deal.findFirst({
        where: {
          organizationId,
          status: "WON",
        },
        orderBy: { closedAt: "desc" },
        select: {
          id: true,
          value: true,
          closedAt: true,
          owner: { select: { name: true, image: true } },
        },
      });

      // `image` de User guarda ou uma chave privada do R2 ("avatars/...",
      // precisa virar URL assinada) ou uma URL externa já pronta (foto de
      // conta Google) — sem esse resolve, uma chave R2 crua ia pro cliente
      // como está, e um <img src="avatars/xxx.jpg"> vira um caminho relativo
      // quebrado (foto sempre em branco no Ranking/Última Venda da TV). Um
      // resolve só, batendo os dois widgets de uma vez (nunca resolve a
      // mesma chave duas vezes, ver resolveAvatarUrlMap em lib/r2.ts).
      const avatarMap = await resolveAvatarUrlMap([...rankingRaw.map((r) => r.image), lastSale?.owner?.image]);
      const ranking = rankingRaw.map((r) => ({ ...r, image: r.image ? (avatarMap.get(r.image) ?? null) : null }));

      // 3. Vendas Anuais
      const wonDealsThisYear = await prisma.deal.aggregate({
        where: {
          organizationId,
          status: "WON",
          closedAt: { gte: yearStart },
        },
        _sum: { value: true },
      });
      const vendasAnuais = Number(wonDealsThisYear._sum.value || 0);

      // 4. Leads no Funil
      const leadsInFunnels = await Promise.all(
        selectedStageIds.map(async (stageId) => {
          const stage = await prisma.pipelineStage.findUnique({
            where: { id: stageId },
            select: { name: true },
          });
          const count = await prisma.deal.count({
            where: { organizationId, stageId, status: "OPEN" },
          });
          return { id: stageId, name: stage?.name || "Desconhecido", count };
        })
      );

      // 5. Vendas Cotas (Assumiremos o total anual como fallback ou o total histórico de consórcio,
      // mas aqui para manter simples vamos retornar o anual até o usuário pedir alteração)
      const vendasCotas = vendasAnuais;

      // 6b. Aniversariantes do mês — alimenta o carrossel do card Ranking (ver
      // tv-view.tsx: depois de alguns minutos mostrando o pódio, gira pra
      // mostrar quem faz aniversário este mês, destacando quem faz HOJE). Só
      // membros ativos com data de nascimento cadastrada (ver User.birthDate
      // no schema — opcional, então a maioria pode não ter ainda). Mês/dia
      // sempre por getUTCMonth()/getUTCDate() (nunca getMonth()/getDate()
      // locais) porque birthDate é @db.Date, um dia civil puro sem fuso — o
      // Prisma devolve isso como meia-noite UTC, então os getters LOCAIS
      // (que dependeriam do fuso de quem roda o processo) podiam ler o dia
      // ANTERIOR dependendo de onde o servidor está — mesma armadilha que
      // lib/timezone.ts já resolve pra Deal.closedAt, só que aqui não tem
      // conversão de fuso nenhuma a fazer, é literalmente ler os componentes
      // UTC do valor já gravado como estão.
      const membersWithBirthday = await prisma.organizationUser.findMany({
        where: { organizationId, active: true, user: { birthDate: { not: null } } },
        select: { user: { select: { id: true, name: true, image: true, birthDate: true } } },
      });
      const birthdaysThisMonthRaw = membersWithBirthday
        .map((m) => m.user)
        .filter((u): u is typeof u & { birthDate: Date } => u.birthDate !== null && u.birthDate.getUTCMonth() === nowParts.month)
        .sort((a, b) => a.birthDate.getUTCDate() - b.birthDate.getUTCDate());
      const birthdayAvatarMap = await resolveAvatarUrlMap(birthdaysThisMonthRaw.map((u) => u.image));
      const birthdaysThisMonth = birthdaysThisMonthRaw.map((u) => ({
        id: u.id,
        name: u.name,
        image: u.image ? (birthdayAvatarMap.get(u.image) ?? null) : null,
        day: u.birthDate.getUTCDate(),
        isToday: u.birthDate.getUTCDate() === nowParts.day,
      }));

      // 6. Meta do mês (Churrascômetro) — year/month de getBrazilParts, não
      // now.getFullYear()/getMonth() nativos (mesmo motivo do comentário lá
      // em cima): perto da virada do mês, o servidor (UTC) já podia estar
      // num mês diferente do de Brasília e buscar a meta do mês errado.
      const monthlyGoal = await prisma.monthlyGoal.findFirst({
        where: {
          organizationId,
          year: nowParts.year,
          month: nowParts.month + 1,
        }
      });
      const churrascometroTarget = monthlyGoal ? Number(monthlyGoal.value) : 0;

      return {
        vendasAnuais,
        vendasCotas,
        vendasMes: totalVendasMes,
        lastSale: lastSale
          ? {
              id: lastSale.id,
              name: lastSale.owner?.name || "Desconhecido",
              image: lastSale.owner?.image ? (avatarMap.get(lastSale.owner.image) ?? null) : null,
              value: Number(lastSale.value || 0),
              date: lastSale.closedAt || new Date(),
            }
          : null,
        leadsInFunnels,
        ranking,
        birthdaysThisMonth,
        churrascometroProgress:
          churrascometroTarget > 0 ? (totalVendasMes / churrascometroTarget) * 100 : 0,
        adsUrls: config.adsUrls,
        visibleWidgets: config.visibleWidgets,
        // Detecção de deploy novo pela TV — ver lib/server-instance.ts.
        serverInstanceId: SERVER_INSTANCE_ID,
      };
    });
  } catch (error) {
    console.error("[getTvMetrics] Error fetching TV metrics:", error);
    // Return empty/safe defaults if DB fails
    return {
      vendasAnuais: 0,
      vendasCotas: 0,
      vendasMes: 0,
      lastSale: null,
      leadsInFunnels: [],
      ranking: [],
      birthdaysThisMonth: [],
      churrascometroProgress: 0,
      adsUrls: config.adsUrls,
      visibleWidgets: config.visibleWidgets,
      // Mesmo no fallback de erro — se o banco cair, ainda queremos que a
      // TV detecte um deploy novo e recarregue sozinha assim que possível
      // (pode ser exatamente o que resolve o erro, ex.: variável de
      // ambiente corrigida no mesmo deploy).
      serverInstanceId: SERVER_INSTANCE_ID,
    };
  }
}
