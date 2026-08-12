import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { startOfMonth, endOfMonth, startOfYear, endOfYear } from "date-fns";

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
  const startMonth = startOfMonth(now);
  const endMonth = endOfMonth(now);
  const startYear = startOfYear(now);
  const endYear = endOfYear(now);

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
          closedAt: { gte: startMonth, lte: endMonth },
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

      const ranking = Array.from(salesByUser.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 3);

      const totalVendasMes = wonDealsThisMonth.reduce((acc, curr) => acc + Number(curr.value || 0), 0);

      // 2. Última venda
      const lastSale = await prisma.deal.findFirst({
        where: {
          organizationId,
          status: "WON",
        },
        orderBy: { closedAt: "desc" },
        select: {
          value: true,
          closedAt: true,
          owner: { select: { name: true, image: true } },
        },
      });

      // 3. Vendas Anuais
      const wonDealsThisYear = await prisma.deal.aggregate({
        where: {
          organizationId,
          status: "WON",
          closedAt: { gte: startYear, lte: endYear },
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

      // 6. Meta do mês (Churrascômetro)
      const monthlyGoal = await prisma.monthlyGoal.findFirst({
        where: {
          organizationId,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        }
      });
      const churrascometroTarget = monthlyGoal ? Number(monthlyGoal.value) : 0;

      return {
        vendasAnuais,
        vendasCotas: 0,
        vendasMes: totalVendasMes,
        lastSale: lastSale
          ? {
              name: lastSale.owner?.name || "Desconhecido",
              image: lastSale.owner?.image,
              value: Number(lastSale.value || 0),
              date: lastSale.closedAt || new Date(),
            }
          : null,
        leadsInFunnels,
        ranking,
        churrascometroProgress:
          churrascometroTarget > 0 ? (totalVendasMes / churrascometroTarget) * 100 : 0,
        adsUrls: config.adsUrls,
        visibleWidgets: config.visibleWidgets,
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
      churrascometroProgress: 0,
      adsUrls: config.adsUrls,
      visibleWidgets: config.visibleWidgets,
    };
  }
}
