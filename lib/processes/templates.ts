import { prisma } from "@/lib/prisma";

export type RankedTemplate = {
  id: string;
  name: string;
  message: string;
  updatedAt: Date;
  /** Já foi enviado (pro consultor OU pro cliente) NESTE processo específico — evita reenviar sem querer, ver ordenação abaixo. */
  alreadyUsedForProcess: boolean;
  /** Quantas vezes este modelo já foi usado em QUALQUER processo desta mesma etapa — a etapa já implica subcategoria+categoria (ver schema.prisma). */
  usageCountInStage: number;
};

/**
 * Ordena os modelos pra abrir o seletor de "Enviar modelo" já com o mais
 * provável no topo (pedido original: "se nessa etapa/subcategoria/
 * categoria o usuário usa mais esse modelo, ele já fica em primeiro, caso
 * não tenha sido usado com aquele negócio selecionado"). Dois critérios,
 * nesta ordem:
 * 1. Nunca usado NESTE processo primeiro — os já usados vão pro fim da
 *    lista (não escondidos, só despriorizados — às vezes faz sentido
 *    reenviar o mesmo pedido de propósito).
 * 2. Dentro de cada grupo, mais usado NESTA ETAPA primeiro.
 */
export async function rankTemplatesForProcess(
  organizationId: string,
  processId: string,
  stageId: string,
): Promise<RankedTemplate[]> {
  const [templates, usedForThisProcess, usageCounts] = await Promise.all([
    prisma.processTemplate.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    prisma.processTemplateUsage.findMany({
      where: { processId },
      select: { templateId: true },
      distinct: ["templateId"],
    }),
    prisma.processTemplateUsage.groupBy({
      by: ["templateId"],
      where: { organizationId, stageId },
      _count: { templateId: true },
    }),
  ]);

  const usedIds = new Set(usedForThisProcess.map((u) => u.templateId));
  const countByTemplate = new Map(usageCounts.map((u) => [u.templateId, u._count.templateId]));

  return templates
    .map((t) => ({
      id: t.id,
      name: t.name,
      message: t.message,
      updatedAt: t.updatedAt,
      alreadyUsedForProcess: usedIds.has(t.id),
      usageCountInStage: countByTemplate.get(t.id) ?? 0,
    }))
    .sort((a, b) => {
      if (a.alreadyUsedForProcess !== b.alreadyUsedForProcess) return a.alreadyUsedForProcess ? 1 : -1;
      if (b.usageCountInStage !== a.usageCountInStage) return b.usageCountInStage - a.usageCountInStage;
      return a.name.localeCompare(b.name, "pt-BR");
    });
}
