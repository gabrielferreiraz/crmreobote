/**
 * Lista FECHADA das funcionalidades medidas — ver FeatureUsageDaily no
 * schema. Importável no cliente (nenhum import de prisma aqui de propósito,
 * mesmo motivo de lib/notification-settings-constants.ts: importar algo que
 * puxa prisma arrasta `pg` pro bundle do navegador).
 *
 * Fechada por dois motivos:
 * 1. Segurança: o cliente manda a chave, então o servidor descarta o que
 *    não estiver aqui (ver recordFeatureUsage) — senão um cliente adulterado
 *    encheria a tabela com chaves inventadas.
 * 2. Interpretação: medir "todo botão" daria centenas de chaves que ninguém
 *    lê. Aqui só entram ações que respondem uma pergunta de produto de
 *    verdade — "usam a ação em massa?", "abrem Relatórios?".
 *
 * Como medir uma ação nova: acrescente a chave aqui com um rótulo em
 * português e chame `trackUse("a.chave")` no lugar onde a ação ACONTECE
 * (não no render) — ver lib/feature-usage/track.ts.
 *
 * Convenção da chave: "tela.area.acao", minúsculo, sem acento — o rótulo é
 * que aparece na tela, a chave é estável pra sempre (renomear chave perde o
 * histórico dela).
 */
export const FEATURE_LABELS = {
  // Pipeline — o coração do CRM, e onde acabamos de mexer bastante
  "pipeline.selecao.abrir": "Pipeline · abrir modo seleção",
  "pipeline.selecao.etapa-inteira": "Pipeline · selecionar etapa inteira",
  "pipeline.massa.etapa": "Pipeline · massa: trocar etapa",
  "pipeline.massa.funil": "Pipeline · massa: trocar funil",
  "pipeline.massa.responsavel": "Pipeline · massa: trocar responsável",
  "pipeline.massa.origem": "Pipeline · massa: trocar origem",
  "pipeline.massa.ganho": "Pipeline · massa: marcar ganho",
  "pipeline.massa.perdido": "Pipeline · massa: marcar perdido",
  "pipeline.massa.mensagem": "Pipeline · massa: enviar mensagem",
  "pipeline.card.arrastar": "Pipeline · arrastar card entre etapas",
  "pipeline.visao.lista": "Pipeline · trocar pra visão Lista",
  "pipeline.negocio.novo": "Pipeline · criar negócio",
  "pipeline.importar": "Pipeline · importar planilha",
  "pipeline.exportar": "Pipeline · exportar planilha",

  // Clientes — cadastro, planilha e ações em massa sobre a carteira
  "clientes.contato.novo": "Clientes · criar contato",
  "clientes.contato.editar": "Clientes · editar contato",
  "clientes.importar": "Clientes · importar planilha",
  "clientes.exportar": "Clientes · exportar planilha",
  "clientes.massa.mensagem": "Clientes · massa: enviar mensagem",
  "clientes.massa.negocio": "Clientes · massa: criar negócios",
  "clientes.massa.apagar": "Clientes · massa: apagar",

  // Negócio — o desfecho de uma venda
  "negocio.ganho": "Negócio · marcar ganho",
  "negocio.perdido": "Negócio · marcar perdido",

  // Propostas comerciais — o funil inteiro, da criação ao aceite
  "proposta.criar": "Proposta · criar",
  "proposta.gerar": "Proposta · gerar documento",
  "proposta.pdf": "Proposta · imprimir / salvar PDF",
  "proposta.enviada": "Proposta · marcar como enviada",
  "proposta.aceita": "Proposta · cliente aceitou",
  "proposta.recusada": "Proposta · cliente recusou",
  "proposta.refeita": "Proposta · refazer (nova revisão)",

  // Agenda
  "agenda.atividade.nova": "Agenda · criar atividade",
  "agenda.atividade.concluir": "Agenda · concluir atividade",

  // WhatsApp — o dia a dia da conversa
  "whatsapp.mensagem.enviar": "WhatsApp · enviar mensagem de texto",
  "whatsapp.audio.enviar": "WhatsApp · enviar áudio",
  "whatsapp.pix.enviar": "WhatsApp · enviar Pix",
  "whatsapp.anexo.enviar": "WhatsApp · enviar imagem/contato",
  "whatsapp.script.enviar": "WhatsApp · enviar script na conversa",

  // Campanhas
  "campanhas.criar": "Campanhas · criar campanha",
  "campanhas.iniciar": "Campanhas · iniciar / retomar",
  "campanhas.pausar": "Campanhas · pausar",
  "campanhas.parar": "Campanhas · parar de vez",
  "campanhas.enviar-agora": "Campanhas · \"Enviar agora\"",
  "campanhas.fila.reordenar": "Campanhas · reordenar a fila de disparo (arrastar)",
  "campanhas.fila.mover": "Campanhas · mover contato pro topo/fim da fila",

  // Scripts e ditado por voz — adoção de recurso novo
  "scripts.salvar": "Scripts · salvar script",
  "voz.ditar": "Ditado por voz · começar a ditar",

  // Pedido/assunção de lead entre consultores
  "leads.solicitar": "Leads · solicitar lead de outro consultor",
  "leads.assumir": "Leads · assumir lead",

  // Relatórios
  "relatorios.negocios-ganhos": "Relatórios · ver negócios ganhos",

  // Busca geral (Cmd+K) — dá pra saber se vale investir nela
  "busca.abrir": "Busca geral (Cmd+K)",
} as const;

export type FeatureKey = keyof typeof FEATURE_LABELS;

export const FEATURE_KEYS = Object.keys(FEATURE_LABELS) as FeatureKey[];

export function isFeatureKey(value: unknown): value is FeatureKey {
  // hasOwnProperty, NÃO `value in FEATURE_LABELS`: o `in` também enxerga o
  // protótipo do objeto, então "constructor", "toString", "__proto__"... passavam
  // como funcionalidade válida. O cliente manda a chave, então um usuário logado
  // conseguia gravar linha com essa chave — e featureLabel() devolvia uma FUNÇÃO
  // pro relatório tentar renderizar, derrubando a tela "Uso do CRM" do Dono.
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FEATURE_LABELS, value);
}

/** Rótulo pra exibição; cai na própria chave se alguma linha antiga ficou no banco com uma chave já removida daqui. */
export function featureLabel(key: string): string {
  return isFeatureKey(key) ? FEATURE_LABELS[key] : key;
}
