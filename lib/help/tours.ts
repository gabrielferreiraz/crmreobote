import type { HelpTour } from "./types";

/**
 * Tours guiados — a parte "mostra na tela" da ajuda.
 *
 * Em vez de descrever onde fica um botão (que o leitor ainda precisa
 * traduzir pra tela dele), o tour ESCURECE a página, recorta o elemento de
 * verdade e escreve ao lado. É a diferença entre ler a receita e ver a mão
 * fazendo.
 *
 * Contrato dos alvos: sempre `[data-help="..."]`. Atributo explícito, posto
 * de propósito no elemento — nunca uma classe de layout, que qualquer ajuste
 * de design mudaria e quebraria o tour em silêncio. Um alvo que não existir
 * na tela (papel sem aquele botão, largura de janela que esconde o item)
 * NÃO quebra nada: o passo vira um card centralizado com o mesmo texto (ver
 * components/help/help-tour.tsx).
 *
 * Por que só um tour por enquanto: este aponta elementos do cabeçalho, que
 * existem em TODA tela do dashboard — o tipo de alvo que não sai do lugar.
 * Tour de tela específica (Pipeline, Conversas) exige âncora dentro daquela
 * tela; dá pra acrescentar aqui depois, sem mexer no motor.
 */
export const HELP_TOURS: HelpTour[] = [
  {
    id: "conhecer-o-crm",
    title: "Conhecer o CRM",
    steps: [
      {
        title: "Bem-vindo ao CRM",
        body: "São 6 paradas rápidas pelas partes que você vai usar todo dia. Dá pra sair quando quiser — e refazer depois, por aqui mesmo.",
      },
      {
        target: "nav",
        title: "Suas áreas de trabalho",
        body: "Clientes é a sua carteira, Pipeline são as vendas em andamento, WhatsApp é o atendimento e Agenda é o seu dia. Relatórios mostra o resultado de tudo isso.",
      },
      {
        target: "search",
        title: "A busca que economiza mais tempo",
        body: "Ctrl+K de qualquer tela. Digite o nome ou o WhatsApp do cliente e vá direto pra ficha dele — sem procurar em lista nenhuma.",
      },
      {
        target: "new-deal",
        requiresTarget: true,
        title: "Registrar uma venda nova",
        body: "Todo atendimento que virou oportunidade precisa de um negócio aqui. É ele que anda pelas etapas do funil e aparece no relatório no fim do mês.",
      },
      {
        target: "notifications",
        title: "Nada passa batido",
        body: "Mensagem nova, tarefa do dia e negócio que chegou pra você aparecem aqui. Vale ativar também a notificação no celular, no seu perfil.",
      },
      {
        target: "help-launcher",
        title: "A ajuda mora aqui",
        body: "Esse botão te acompanha em todas as telas. Ele sempre abre mostrando dicas da tela em que você está — e tem busca, se preferir procurar.",
      },
    ],
  },
];

export const HELP_TOUR_BY_ID = new Map(HELP_TOURS.map((t) => [t.id, t]));
