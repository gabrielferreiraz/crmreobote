import { prisma } from "@/lib/prisma";
import { brazilDateKey } from "@/lib/timezone";
import { featureLabel, FEATURE_KEYS, FEATURE_LABELS } from "./features";

export type FeatureUsageRow = {
  feature: string;
  label: string;
  total: number;
  /** Quantas PESSOAS diferentes usaram no período — separa "a equipe usa" de "uma pessoa usa muito". */
  userCount: number;
};

export type FeatureUsageReport = {
  days: number;
  from: string;
  rows: FeatureUsageRow[];
  /** Funcionalidades medidas que não tiveram NENHUM uso no período — a informação mais acionável da tela. */
  unused: { feature: string; label: string }[];
  /** Nenhum dado ainda (medição recém-ligada) — a tela avisa em vez de mostrar "tudo com zero" como se fosse conclusão. */
  empty: boolean;
};

/**
 * Agrega o uso por funcionalidade no período. Já roda dentro de
 * runWithTenant.
 *
 * Por ORGANIZAÇÃO, não por pessoa, de propósito: a pergunta que motivou
 * isto é de produto ("onde melhorar o CRM", ver o pedido), e essa se
 * responde com o total da equipe. "Quem está usando o CRM" é outra
 * pergunta, de gestão de gente, e já tem resposta própria em Relatórios →
 * Atividade da equipe (UserDailyActivity). `userCount` é o meio-termo
 * necessário: sem ele, um número alto podia ser a equipe toda ou uma
 * pessoa só, e a conclusão sobre "investir nisso" seria oposta.
 */
export async function getFeatureUsageReport(organizationId: string, days = 30): Promise<FeatureUsageReport> {
  const from = brazilDateKey(new Date(Date.now() - days * 86_400_000));

  const groups = await prisma.featureUsageDaily.groupBy({
    by: ["feature"],
    where: { organizationId, date: { gte: from } },
    _sum: { count: true },
  });

  // groupBy não conta "usuários distintos" (contaria linhas, e há uma linha
  // por usuário POR DIA) — daí a segunda passada. `distinct` resolve no
  // banco, sem trazer linha por linha pra memória.
  const distinctPairs = await prisma.featureUsageDaily.findMany({
    where: { organizationId, date: { gte: from } },
    select: { feature: true, userId: true },
    distinct: ["feature", "userId"],
  });
  const usersByFeature = new Map<string, number>();
  for (const { feature } of distinctPairs) usersByFeature.set(feature, (usersByFeature.get(feature) ?? 0) + 1);

  const rows: FeatureUsageRow[] = groups
    .map((g) => ({
      feature: g.feature,
      label: featureLabel(g.feature),
      total: g._sum.count ?? 0,
      userCount: usersByFeature.get(g.feature) ?? 0,
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);

  // Lista fechada menos o que apareceu — "ninguém abriu isso em 30 dias" é
  // justamente o sinal que a medição existe pra dar, e ele nunca sai de uma
  // consulta sozinha (o que não foi usado não tem linha no banco).
  const seen = new Set(rows.map((r) => r.feature));
  const unused = FEATURE_KEYS.filter((k) => !seen.has(k)).map((k) => ({ feature: k, label: FEATURE_LABELS[k] }));

  return { days, from, rows, unused, empty: rows.length === 0 };
}
