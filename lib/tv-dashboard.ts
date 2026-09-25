import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveAvatarUrlMap } from "@/lib/r2";
import { brazilStartOfMonth, brazilStartOfYear, getBrazilParts } from "@/lib/timezone";
import { SERVER_INSTANCE_ID } from "@/lib/server-instance";
import { getGoalExcludedOwnerIds } from "@/lib/goals/suggestion";

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
      // Quem CONTA como time atual pra TV — negócio de quem já saiu da
      // empresa continua no banco com o ownerId de sempre (não é reatribuído
      // sozinho quando alguém é desativado). Mesmo raciocínio já documentado
      // pros rankings do relatório Comercial (ver activeMemberIds em
      // lib/reports/commercial-data.ts): usado abaixo pro Ranking, Última
      // venda e Leads no Funil (widgets "de gente" — ranking/nome/lista de
      // pessoa), mas de propósito NÃO pros totais de faturamento (Vendas do
      // Mês/Vendas Anuais, ver totalVendasMes/vendasAnuais abaixo) — venda
      // que já entrou continua sendo receita real da empresa, mesmo que
      // quem vendeu não trabalhe mais aqui (mesma decisão de "Total ganho"
      // em Relatórios: total da organização nunca exclui histórico).
      //
      // goalExcludedOwnerIds é um eixo DIFERENTE (ver countsTowardGoal no
      // schema) — esse sim tira do TOTAL também (não só do ranking/última
      // venda): sócio (Dono) vendendo cota da própria Reobote nunca deveria
      // ter entrado nesses números pra começo de conversa, então já sai lá
      // na consulta de wonDealsThisMonth/wonDealsThisYear abaixo, não só
      // depois em memória.
      const [activeMembers, goalExcludedOwnerIds] = await Promise.all([
        prisma.organizationUser.findMany({
          where: { organizationId, active: true },
          select: { userId: true },
        }),
        // Sócio (Dono) que fecha negócio da própria Reobote não é meta de
        // consultor nem "ganho" pra aparecer pro time inteiro na TV (ver
        // countsTowardGoal no schema/getGoalExcludedOwnerIds) — aplicado
        // abaixo em TODO widget de valor/ganho (Vendas do mês/ano,
        // Ranking, Última venda, Churrascômetro), eixo INDEPENDENTE de
        // "ativo" (um dono pode estar ativo e ainda assim nunca contar).
        getGoalExcludedOwnerIds(organizationId),
      ]);
      const activeOwnerIds = activeMembers.map((m) => m.userId);

      // 1. Vendas ganhas do mês — pros TOTAIS (Vendas do mês e valor bruto).
      const wonDealsThisMonth = await prisma.deal.findMany({
        where: {
          organizationId,
          status: "WON",
          closedAt: { gte: monthStart },
          ...(goalExcludedOwnerIds.length > 0 ? { ownerId: { notIn: goalExcludedOwnerIds } } : {}),
        },
        select: {
          value: true,
          // Valor bruto (ver Deal.grossValue no schema) — só pro card
          // "Vendas do mês" (fileira Anuais/Cotas, ver vendasBrutoMes
          // abaixo), nunca pra Última venda/hero, que continuam 100%
          // líquido (`value`) de propósito.
          grossValue: true,
        },
      });

      // Ranking (pódio) — SÓ os 3 primeiros vão pro payload desta TV, que fica à
      // vista de cliente (pedido da diretoria, 09/2026): a lista completa de
      // quem vendeu no mês, inclusive quem ainda não fechou nada, vive em
      // getTvRanking, servido só na TV interna (app/r/[code]). O corte é AQUI,
      // no servidor — mandar todo mundo e só esconder na tela deixaria o resto
      // do time no navegador da TV.
      const rankingRaw = (await computeMonthRanking(organizationId, monthStart, "podium")).slice(0, TV_PODIUM_SIZE);

      const totalVendasMes = wonDealsThisMonth.reduce((acc, curr) => acc + Number(curr.value || 0), 0);
      // Bruto do MÊS (não do ano) — mesmo filtro `closedAt >= monthStart` de
      // totalVendasMes acima (zera sozinho na virada do mês, meia-noite de
      // Brasília), só somando grossValue em vez de value. Reaproveita
      // wonDealsThisMonth já buscado ali em cima (mesmas linhas, sem 2ª
      // consulta) — grossValue é nullable (Deal antigo, de antes de
      // 08/2026, ou preenchido sem valor bruto) e simplesmente não entra na
      // soma, igual `value` ausente já era tratado.
      const vendasBrutoMes = wonDealsThisMonth.reduce((acc, curr) => acc + Number(curr.grossValue || 0), 0);

      // 2. Última venda — só de consultor ATIVO (pula pra próxima venda mais
      // recente se a última registrada for de quem já saiu). id e closedAt junto pra
      // tv-view.tsx saber DE VERDADE quando é uma venda nova (não só "o
      // valor mudou", que também aconteceria se o MESMO negócio fosse
      // reaberto/editado) e disparar a comemoração de confete só nesse
      // caso, nunca a cada refresh (ver METRICS_POLL_MS em tv-view.tsx).
      //
      // orderBy tem um 2º critério (id desc) de propósito — negócios
      // importados do Agendor (ver scripts/agendor/import-negocios.ts)
      // têm closedAt vindo de uma célula de planilha só com DIA, sem
      // horário, então dois negócios ganhos no mesmo dia gravam o
      // MESMÍSSIMO instante (meia-noite). Só com closedAt como critério,
      // um empate desses faz o Postgres devolver ora um ora outro a cada
      // poll de 15s (ver METRICS_POLL_MS) — na TV parecia a última venda
      // "ficar alternando" entre dois consultores sozinha. id é cuid
      // (cresce com a ordem de inserção) e nunca empata, então desempata
      // sempre pro mesmo lado — resultado estável entre polls.
      const lastSale = await prisma.deal.findFirst({
        where: {
          organizationId,
          status: "WON",
          // in + notIn no mesmo campo = AND (precisa das duas: time ATUAL
          // e que CONTA na meta) — mesmo raciocínio de wonDealsThisMonth
          // acima, só que aqui como filtro único em vez de dois.
          ownerId: { in: activeOwnerIds, ...(goalExcludedOwnerIds.length > 0 ? { notIn: goalExcludedOwnerIds } : {}) },
        },
        orderBy: [{ closedAt: "desc" }, { id: "desc" }],
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
          ...(goalExcludedOwnerIds.length > 0 ? { ownerId: { notIn: goalExcludedOwnerIds } } : {}),
        },
        _sum: { value: true },
      });
      const vendasAnuais = Number(wonDealsThisYear._sum.value || 0);

      // 4. Leads no Funil — só de consultor ATIVO (activeOwnerIds já
      // calculado lá em cima, reaproveitado do Ranking/Última venda).
      const leadsInFunnels = await Promise.all(
        selectedStageIds.map(async (stageId) => {
          const stage = await prisma.pipelineStage.findUnique({
            where: { id: stageId },
            select: { name: true },
          });
          const count = await prisma.deal.count({
            where: { organizationId, stageId, status: "OPEN", ownerId: { in: activeOwnerIds } },
          });
          return { id: stageId, name: stage?.name || "Desconhecido", count };
        })
      );

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
        vendasBrutoMes,
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
      vendasBrutoMes: 0,
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

/** Quantos entram no pódio da TV principal (à vista de cliente) — ver getTvMetrics. */
const TV_PODIUM_SIZE = 3;

/**
 * Soma das vendas GANHAS do mês por consultor, do que mais vendeu pro que
 * menos — a regra do ranking num lugar só, usada tanto pelo pódio da TV
 * principal (top 3, getTvMetrics) quanto pelo ranking completo da TV interna
 * (getTvRanking), pra os dois nunca divergirem. Precisa rodar DENTRO de
 * runWithTenant (RLS). `image` volta como está no banco (chave privada do R2
 * ou URL pronta): quem chama resolve com resolveAvatarUrlMap.
 *
 * Regras:
 * - só time ATUAL (ex-consultor nunca aparece, mesmo tendo vendido antes de
 *   sair; o total da empresa continua contando a venda dele);
 * - só quem está marcado pra aparecer NESTE ranking — `where` "podium" lê
 *   OrganizationUser.showInPodium, "month" lê showInMonthRanking (ver schema).
 *   Eixo separado de countsTowardGoal: supervisor soma na meta e fica fora do
 *   pódio da TV principal (pedido da diretoria, 09/2026);
 * - nome da PJ do consultor quando ele cadastrou uma (UserCompany), nome
 *   pessoal quando não — pedido explícito, o ranking mostra a EMPRESA.
 */
async function computeMonthRanking(organizationId: string, monthStart: Date, where: "podium" | "month") {
  const eligible = await prisma.organizationUser.findMany({
    where: { organizationId, active: true, ...(where === "podium" ? { showInPodium: true } : { showInMonthRanking: true }) },
    select: { userId: true },
  });
  if (eligible.length === 0) return [];

  // groupBy em vez de trazer todo negócio do mês e somar em memória — o banco
  // já devolve uma linha por consultor.
  const grouped = await prisma.deal.groupBy({
    by: ["ownerId"],
    where: {
      organizationId,
      status: "WON",
      closedAt: { gte: monthStart },
      ownerId: { in: eligible.map((e) => e.userId) },
    },
    _sum: { value: true },
  });

  const users = grouped.length
    ? await prisma.user.findMany({
        where: { id: { in: grouped.map((g) => g.ownerId) } },
        select: { id: true, name: true, image: true, company: { select: { name: true } } },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  return grouped
    .flatMap((g) => {
      const user = userById.get(g.ownerId);
      if (!user) return [];
      return [
        {
          id: user.id,
          name: user.company?.name ?? user.name,
          image: user.image,
          total: Number(g._sum.value ?? 0),
        },
      ];
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * Ranking do mês COMPLETO — TODOS os consultores que fecharam venda no mês
 * corrente, do que mais vendeu pro que menos. Servido só pela tela interna do
 * Ranking (link público de código próprio em app/r/[code], sem login). A TV
 * principal mostra só o PÓDIO (top 3, ver getTvMetrics acima e o comentário lá
 * sobre o corte no servidor): a diretoria não quer que um cliente que
 * esteja na Reobote enxergue, por exemplo, que um consultor ainda não fechou
 * nada no mês.
 *
 * Mesmas regras que o ranking sempre teve:
 * - só time ATUAL (ex-consultor nunca aparece, mesmo tendo vendido antes de
 *   sair — o total da empresa em getTvMetrics continua contando a venda dele);
 * - só quem está marcado "Ranking do mês" (showInMonthRanking — Dono fica
 *   fora por padrão, supervisor ENTRA, ao contrário do pódio);
 * - nome da PJ do consultor quando ele cadastrou uma (UserCompany), nome
 *   pessoal quando não — pedido explícito, o ranking mostra a EMPRESA.
 *
 * Sem o teto de 50 que o painel da TV principal usava: aqui o pedido é
 * "mostra todos que venderam naquele mês". O teto de 200 é só uma rede de
 * segurança contra uma organização gigante mandando uma lista absurda pro
 * navegador da TV — bem acima de qualquer time real.
 */
export async function getTvRanking(organizationId: string) {
  const now = new Date();
  const monthStart = brazilStartOfMonth(now);
  const nowParts = getBrazilParts(now);
  // "setembro de 2026" — mês/ano de Brasília (nowParts), formatado em UTC de
  // propósito: o dia 1º à meia-noite UTC nunca cruza a virada de mês em
  // nenhum fuso, então o nome do mês sai sempre certo.
  const monthLabel = new Date(Date.UTC(nowParts.year, nowParts.month, 1)).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  try {
    return await runWithTenant(organizationId, async () => {
      const rankingRaw = (await computeMonthRanking(organizationId, monthStart, "month")).slice(0, 200);

      // Mesmo motivo de resolveAvatarUrlMap em getTvMetrics: `image` pode ser
      // uma chave privada do R2 que precisa virar URL assinada.
      const avatarMap = await resolveAvatarUrlMap(rankingRaw.map((r) => r.image));
      const ranking = rankingRaw.map((r) => ({ ...r, image: r.image ? (avatarMap.get(r.image) ?? null) : null }));

      // Detecção de deploy novo pela TV — ver lib/server-instance.ts.
      return { ranking, monthLabel, serverInstanceId: SERVER_INSTANCE_ID };
    });
  } catch (error) {
    console.error("[getTvRanking] Error fetching TV ranking:", error);
    // Mesmo no fallback de erro a TV ainda precisa detectar um deploy novo e
    // recarregar sozinha (pode ser exatamente o que resolve o erro).
    return { ranking: [], monthLabel, serverInstanceId: SERVER_INSTANCE_ID };
  }
}
