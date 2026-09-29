import type { FeatureKey } from "@/lib/feature-usage/features";

/**
 * "Você sabia?" — a parte da ajuda que não espera a pergunta.
 *
 * O CRM já mede, por pessoa, quais ações cada um usa (FeatureUsageDaily, ver
 * lib/feature-usage/). Isso responde de graça a pergunta mais difícil de
 * treinamento: o que ESTA pessoa ainda não descobriu. Quem nunca abriu a
 * busca rápida recebe a dica da busca rápida; quem já usa tudo isso recebe
 * outra coisa.
 *
 * Só entram aqui recursos que economizam tempo de verdade, na ordem de
 * impacto — a primeira dica que a pessoa receber é a que decide se ela vai
 * confiar nas próximas.
 */
export const DISCOVERY_ORDER: { feature: FeatureKey; topicId: string }[] = [
  { feature: "busca.abrir", topicId: "busca-rapida" },
  { feature: "pipeline.selecao.abrir", topicId: "acoes-em-massa" },
  { feature: "scripts.salvar", topicId: "scripts" },
  { feature: "voz.ditar", topicId: "ditado-voz" },
  { feature: "campanhas.criar", topicId: "campanhas" },
  { feature: "proposta.criar", topicId: "propostas" },
  { feature: "clientes.importar", topicId: "importar-clientes" },
  { feature: "agenda.atividade.nova", topicId: "criar-atividade" },
  { feature: "relatorios.negocios-ganhos", topicId: "relatorios" },
  { feature: "pipeline.exportar", topicId: "exportar" },
  { feature: "whatsapp.audio.enviar", topicId: "conversas" },
  { feature: "pipeline.card.arrastar", topicId: "mover-etapas" },
];

/**
 * Pra quem já usou tudo que é medido — sem isso, o veterano do time nunca
 * mais veria uma dica. São recursos que não têm medição própria hoje, mas
 * que muita gente não conhece.
 */
export const EVERGREEN_TOPIC_IDS = [
  "desfazer",
  "atalhos",
  "cartao-digital",
  "mensagem-agendada",
  "resultado-reuniao",
  "google-agenda",
  "tags-qualificacao",
];
