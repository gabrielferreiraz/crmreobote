import type { HelpScreen } from "./types";

/**
 * "Onde eu estou e o que dá pra fazer aqui."
 *
 * É a parte da ajuda que mais desmonta o problema real: o consultor não
 * sabe o NOME do que procura, então uma busca em branco não resolve. Casar
 * a rota atual com 3 ou 4 tópicos certos entrega a resposta antes de
 * alguém precisar formular a pergunta.
 *
 * Primeira regra que casa vence — as rotas mais específicas vêm antes.
 */
const SCREENS: { match: (pathname: string) => boolean; screen: HelpScreen }[] = [
  {
    match: (p) => p === "/",
    screen: {
      title: "Início",
      purpose: "O resumo do seu dia: o que está atrasado, o que vence hoje e como anda o mês.",
      topicIds: ["criar-atividade", "busca-rapida", "conectar-whatsapp"],
    },
  },
  {
    match: (p) => p.startsWith("/clientes/"),
    screen: {
      title: "Ficha do cliente",
      purpose: "Tudo sobre uma pessoa: contato, etiquetas, negócios e histórico.",
      topicIds: ["tags-qualificacao", "registrar-atividade", "conversas"],
    },
  },
  {
    match: (p) => p.startsWith("/clientes"),
    screen: {
      title: "Clientes",
      purpose: "Sua carteira inteira — filtre, marque e trabalhe vários de uma vez.",
      topicIds: ["novo-cliente", "importar-clientes", "acoes-em-massa", "exportar"],
    },
  },
  {
    match: (p) => p.startsWith("/negocios"),
    screen: {
      title: "Negócio",
      purpose: "A venda em andamento: histórico, próximos passos, proposta e desfecho.",
      topicIds: ["registrar-atividade", "propostas", "ganhar-negocio", "perder-negocio"],
    },
  },
  {
    match: (p) => p.startsWith("/pipeline"),
    screen: {
      title: "Pipeline",
      purpose: "O funil em cards: cada coluna é uma etapa, cada card é uma venda em andamento.",
      topicIds: ["criar-negocio", "mover-etapas", "acoes-em-massa", "ganhar-negocio"],
    },
  },
  {
    match: (p) => p.startsWith("/agenda"),
    screen: {
      title: "Agenda",
      purpose: "Suas tarefas e compromissos, em lista ou calendário.",
      topicIds: ["criar-atividade", "resultado-reuniao", "mensagem-agendada", "google-agenda"],
    },
  },
  {
    match: (p) => p.startsWith("/whatsapp/conversas"),
    screen: {
      title: "Conversas",
      purpose: "Atendimento pelo WhatsApp sem sair do CRM, já ligado ao cliente.",
      topicIds: ["conversas", "scripts", "atalhos"],
    },
  },
  {
    match: (p) => p.startsWith("/whatsapp/campanhas"),
    screen: {
      title: "Campanhas",
      purpose: "Disparo de um script pra uma lista de contatos, no seu ritmo.",
      topicIds: ["campanhas", "scripts", "conectar-whatsapp"],
    },
  },
  {
    match: (p) => p.startsWith("/whatsapp/scripts"),
    screen: {
      title: "Scripts",
      purpose: "Sua biblioteca de mensagens prontas, com variáveis que preenchem sozinhas.",
      topicIds: ["scripts", "campanhas"],
    },
  },
  {
    match: (p) => p.startsWith("/whatsapp"),
    screen: {
      title: "WhatsApp",
      purpose: "Conversas, scripts e campanhas — tudo que sai do seu número.",
      topicIds: ["conversas", "scripts", "campanhas", "conectar-whatsapp"],
    },
  },
  {
    match: (p) => p.startsWith("/relatorios"),
    screen: {
      title: "Relatórios",
      purpose: "Os números do período: entradas, fechamentos e onde o funil trava.",
      topicIds: ["relatorios", "ganhar-negocio", "resultado-reuniao"],
    },
  },
  {
    match: (p) => p.startsWith("/automacoes"),
    screen: {
      title: "Automações",
      purpose: "Regras que o CRM executa sozinho quando algo acontece.",
      topicIds: ["automacoes", "scripts"],
    },
  },
  {
    match: (p) => p.startsWith("/configuracoes/meu-cartao"),
    screen: {
      title: "Cartão Digital",
      purpose: "Seu cartão de visita: link, QR Code e quem andou abrindo.",
      topicIds: ["cartao-digital"],
    },
  },
  {
    match: (p) => p.startsWith("/configuracoes"),
    screen: {
      title: "Configurações",
      purpose: "Ajustes da sua conta e, pra quem administra, do time inteiro.",
      topicIds: ["conectar-whatsapp", "perfil-foto", "configurar-funil", "usuarios-permissoes"],
    },
  },
  {
    match: (p) => p.startsWith("/processos"),
    screen: {
      title: "Processos",
      purpose: "O pós-venda em Kanban: documentação e andamento de cada contrato.",
      topicIds: ["registrar-atividade", "busca-rapida"],
    },
  },
];

export function screenForPath(pathname: string): HelpScreen | null {
  return SCREENS.find((s) => s.match(pathname))?.screen ?? null;
}
