import { prisma } from "@/lib/prisma";
import { brazilDateKey } from "@/lib/timezone";
import { featureLabel, FEATURE_KEYS, FEATURE_LABELS } from "./features";

export type FeatureUsagePerson = { userId: string; name: string; count: number };

export type FeatureUsageRow = {
  feature: string;
  label: string;
  total: number;
  /** Quantas PESSOAS diferentes usaram no período — separa "a equipe usa" de "uma pessoa usa muito". */
  userCount: number;
  /** Quem usou e quantas vezes, do que mais usou pro que menos usou. */
  people: FeatureUsagePerson[];
};

export type PersonUsage = {
  userId: string;
  name: string;
  /** false = já saiu da equipe (o histórico dele continua valendo no total das funcionalidades). */
  active: boolean;
  /** Soma de todas as ações medidas dele no período. */
  total: number;
  /** O que essa pessoa mais usou, do maior pro menor. */
  features: { feature: string; label: string; count: number }[];
};

export type FeatureUsageReport = {
  days: number;
  from: string;
  rows: FeatureUsageRow[];
  /** Por pessoa, do que mais usou o CRM pro que menos usou. */
  people: PersonUsage[];
  /** Membros ATIVOS sem nenhuma ação medida no período — quem provavelmente ainda não adotou. */
  idle: { userId: string; name: string }[];
  /** Funcionalidades medidas que não tiveram NENHUM uso no período — a informação mais acionável da tela. */
  unused: { feature: string; label: string }[];
  /** Nenhum dado ainda (medição recém-ligada) — a tela avisa em vez de mostrar "tudo com zero" como se fosse conclusão. */
  empty: boolean;
};

/**
 * Agrega o uso no período, por funcionalidade E por pessoa. Já roda dentro de
 * runWithTenant.
 *
 * Até 09/2026 este relatório era só por organização, de propósito (a pergunta
 * era "onde melhorar o CRM"). O Dono pediu a quebra POR PESSOA ("quais pessoas
 * e quantas vezes clicam em tais botões"). Não precisou de mudança de banco:
 * FeatureUsageDaily já guardava (usuário, dia, funcionalidade). A tela que
 * mostra isto continua sendo só do Dono (ver uso/page.tsx) — é dado sobre
 * gente, não sobre produto.
 *
 * Uma passada só no banco (groupBy feature × usuário) alimenta as duas visões:
 * a lista fechada de funcionalidades (~50) vezes a equipe (dezenas) é um
 * volume pequeno pra agregar em memória.
 */
export async function getFeatureUsageReport(organizationId: string, days = 30): Promise<FeatureUsageReport> {
  const from = brazilDateKey(new Date(Date.now() - days * 86_400_000));

  const [pairs, members] = await Promise.all([
    prisma.featureUsageDaily.groupBy({
      by: ["feature", "userId"],
      where: { organizationId, date: { gte: from } },
      _sum: { count: true },
    }),
    // Nome e situação de TODOS os membros da organização: dá o nome de quem
    // usou, e a lista de quem NÃO usou nada (o que não tem linha no banco).
    prisma.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true, active: true, user: { select: { name: true } } },
    }),
  ]);

  const memberById = new Map(members.map((m) => [m.userId, { name: m.user.name, active: m.active }]));
  const nameOf = (userId: string) => memberById.get(userId)?.name ?? "Usuário removido";

  const byFeature = new Map<string, FeatureUsagePerson[]>();
  const byPerson = new Map<string, { feature: string; label: string; count: number }[]>();
  for (const pair of pairs) {
    const count = pair._sum.count ?? 0;
    if (count <= 0) continue;
    const people = byFeature.get(pair.feature) ?? [];
    people.push({ userId: pair.userId, name: nameOf(pair.userId), count });
    byFeature.set(pair.feature, people);

    const features = byPerson.get(pair.userId) ?? [];
    features.push({ feature: pair.feature, label: featureLabel(pair.feature), count });
    byPerson.set(pair.userId, features);
  }

  const rows: FeatureUsageRow[] = Array.from(byFeature.entries())
    .map(([feature, people]) => ({
      feature,
      label: featureLabel(feature),
      total: people.reduce((sum, p) => sum + p.count, 0),
      userCount: people.length,
      people: people.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR")),
    }))
    .sort((a, b) => b.total - a.total);

  const people: PersonUsage[] = Array.from(byPerson.entries())
    .map(([userId, features]) => ({
      userId,
      name: nameOf(userId),
      active: memberById.get(userId)?.active ?? false,
      total: features.reduce((sum, f) => sum + f.count, 0),
      features: features.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR")),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "pt-BR"));

  const idle = members
    .filter((m) => m.active && !byPerson.has(m.userId))
    .map((m) => ({ userId: m.userId, name: m.user.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  // Lista fechada menos o que apareceu — "ninguém abriu isso em 30 dias" é
  // justamente o sinal que a medição existe pra dar, e ele nunca sai de uma
  // consulta sozinha (o que não foi usado não tem linha no banco).
  const seen = new Set(rows.map((r) => r.feature));
  const unused = FEATURE_KEYS.filter((k) => !seen.has(k)).map((k) => ({ feature: k, label: FEATURE_LABELS[k] }));

  return { days, from, rows, people, idle, unused, empty: rows.length === 0 };
}
