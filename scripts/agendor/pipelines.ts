/**
 * Mapeamento Funil → Pipeline / Etapa → PipelineStage — os 11 funis reais
 * levantados na análise do arquivo de Negócios, todos entram (confirmado:
 * inclusive "XP Investimentos" e "Funil de Vendas 2023" como Pipeline
 * separado de "Funil de Vendas", não fundidos).
 */

import { prisma } from "@/lib/prisma";
import { ORGANIZATION_ID } from "@/scripts/agendor/users";

// Etapas na ordem em que apareceram nos dados — não precisa ser a ordem de
// funil perfeita (isso dá pra reordenar depois direto na tela de
// Configurações), só precisa existir e bater com o nome usado no Agendor.
const FUNIL_STAGES: Record<string, string[]> = {
  "Funil de Vendas": ["Prospecção", "Mensagem/Ligação", "Em Análise", "Visita Marcada", "Remarketing", "Quente", "Noshow", "EXTRAS"],
  "Funil de Vendas 2023": ["Prospecção", "Mensagem/Ligação", "Em Análise", "Visita Marcada", "Quente", "Fechamento"],
  "Funil de Facebook": ["Lead Formulário", "Lead WhatsApp", "Primeiro Contato", "Segundo Contato", "Terceiro Contato", "Em Análise", "Visita Marcada", "Remarketing", "Quente", "Noshow"],
  "Funil de Dourados": ["Prospecção", "Mensagem/Ligação", "Em análise", "Segundo contato", "Visita Marcada", "Visita Realizada", "Quente", "RMKT", "NOSHOW", "NÃO MEXER"],
  "Funil de SDR": ["Novos Leads", "Novos Leads Ads", "Primeiro dia de Contato", "Segundo dia de Contato", "Terceiro dia de Contato", "Retorno", "Visita Agendada", "Robo WhatsApp", "Robo RMKT", "NoShow"],
  "Funil de Cuiaba": ["Prospecção", "Mensagem/Ligação"],
  "Funil de Robô WhatsApp": ["Prospecção", "Mensagem/Ligação", "Em Análise", "Visita Marcada", "Quente"],
  "Funil de Rondonopolis": ["Prospecção", "Mensagem/Ligação", "Visita marcada"],
  "Funil de Outros": ["SEM CONTATOS", "Contato", "Envio de proposta"],
  "Funil de Chapadão": ["Primeiro Contato", "Segundo Contato", "Ligação", "Retorno", "Robô WhatsApp", "Robô RMKT", "Visita Marcada", "Visita Realizada"],
  "Funil de XP Investimentos": ["Lead", "Em atendimento", "Proposta", "Quente", "Visita marcada", "Remarketing", "No show"],
};

const DEFAULT_PIPELINE = "Funil de Vendas";

/**
 * Trim + remove espaço colado numa barra + colapsa espaço duplicado — os
 * dois tipos de "quase-duplicata" real achados nas etapas do Agendor (ex.:
 * "Mensagem/Ligação" vs "Mensagem/ Ligação" — um espaço A MAIS do lado da
 * barra, não espaço duplicado no meio do texto, por isso precisa das duas
 * regras).
 */
export function normalizeStageName(raw: string): string {
  return raw.trim().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");
}

const stageCache = new Map<string, { pipelineId: string; stageId: string }>(); // `${funil}::${etapa normalizada}` -> ids

/** Cria (se não existir) os 11 pipelines + suas etapas. Roda uma vez, no início do script. */
export async function ensurePipelines(dryRun: boolean): Promise<void> {
  const funilNames = Object.keys(FUNIL_STAGES);
  for (let i = 0; i < funilNames.length; i++) {
    const funilName = funilNames[i];
    const isDefault = funilName === DEFAULT_PIPELINE;

    let pipeline = await prisma.pipeline.findFirst({ where: { organizationId: ORGANIZATION_ID, name: funilName } });
    if (!pipeline) {
      if (dryRun) {
        console.log(`[pipelines] (dry-run) criaria pipeline: ${funilName}`);
      } else {
        pipeline = await prisma.pipeline.create({
          data: { organizationId: ORGANIZATION_ID, name: funilName, isDefault, order: i },
        });
        console.log(`[pipelines] criado: ${funilName}`);
      }
    }

    const stages = FUNIL_STAGES[funilName].map(normalizeStageName);
    for (let j = 0; j < stages.length; j++) {
      const stageName = stages[j];
      const cacheKey = `${funilName}::${stageName}`;
      if (dryRun) {
        stageCache.set(cacheKey, { pipelineId: `dry-run:${funilName}`, stageId: `dry-run:${cacheKey}` });
        continue;
      }
      let stage = await prisma.pipelineStage.findFirst({ where: { pipelineId: pipeline!.id, name: stageName } });
      if (!stage) {
        stage = await prisma.pipelineStage.create({ data: { pipelineId: pipeline!.id, name: stageName, order: j } });
      }
      stageCache.set(cacheKey, { pipelineId: pipeline!.id, stageId: stage.id });
    }
  }
}

/** Resolve Funil+Etapa do Agendor pros ids daqui — lança erro claro se o funil/etapa não estiver na tabela acima (nunca deveria acontecer, mas melhor falhar alto do que importar num pipeline errado). */
export function resolveStage(funil: string, etapa: string): { pipelineId: string; stageId: string } {
  const key = `${funil}::${normalizeStageName(etapa)}`;
  const found = stageCache.get(key);
  if (!found) {
    throw new Error(`Funil/Etapa não mapeado: "${funil}" → "${etapa}" (chave: ${key}) — adicione em FUNIL_STAGES`);
  }
  return found;
}
