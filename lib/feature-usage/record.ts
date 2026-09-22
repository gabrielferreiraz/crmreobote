import { prisma } from "@/lib/prisma";
import { brazilDateKey } from "@/lib/timezone";
import { isFeatureKey } from "./features";

/** Teto por envio — o buffer do cliente tem no máximo uma entrada por funcionalidade medida, então isto só existe pra barrar corpo adulterado. */
const MAX_FEATURES_PER_FLUSH = 100;
/** Idem pro valor: 30s de cliques humanos não passa de algumas dezenas por funcionalidade. */
const MAX_COUNT_PER_FEATURE = 10_000;

/**
 * Soma o lote de cliques que veio do navegador (ver
 * lib/feature-usage/track.ts) no somatório do dia. Já roda dentro de
 * runWithTenant — chamado pela rota do heartbeat.
 *
 * `upsert` com `increment` (não um read+write): duas abas do mesmo usuário
 * podem mandar lote quase junto, e ler-somar-gravar perderia um dos dois.
 * O índice único (organizationId, userId, date, feature) é o que deixa o
 * upsert resolver isso no próprio banco.
 *
 * Nunca lança: é telemetria de produto, não pode derrubar o heartbeat (que
 * também alimenta "online agora" e "tempo no CRM" — dados bem mais
 * importantes que este). Chave desconhecida é descartada em silêncio, ver
 * o comentário de lista fechada em features.ts.
 */
export async function recordFeatureUsage(
  organizationId: string,
  userId: string,
  counts: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(counts)
    .slice(0, MAX_FEATURES_PER_FLUSH)
    .filter((entry): entry is [string, number] => {
      const [feature, count] = entry;
      return (
        isFeatureKey(feature) &&
        typeof count === "number" &&
        Number.isInteger(count) &&
        count > 0 &&
        count <= MAX_COUNT_PER_FEATURE
      );
    });
  if (entries.length === 0) return;

  const date = brazilDateKey(new Date());

  // Sequencial, não Promise.all: são poucas entradas (uma por
  // funcionalidade tocada nos últimos 30s, na prática 1–3) e cada operação
  // do Prisma aqui abre a própria transação curta pra RLS (ver
  // withTenantRls em lib/prisma.ts) — disparar todas em paralelo só
  // multiplicaria transações simultâneas contra o Postgres remoto pra
  // ganhar milissegundos num caminho que ninguém está esperando.
  for (const [feature, count] of entries) {
    try {
      await prisma.featureUsageDaily.upsert({
        where: { organizationId_userId_date_feature: { organizationId, userId, date, feature } },
        create: { organizationId, userId, date, feature, count },
        update: { count: { increment: count } },
      });
    } catch (err) {
      console.error(`[feature-usage] falha ao somar "${feature}"`, err);
    }
  }
}
