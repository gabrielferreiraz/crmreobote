/**
 * Modelo de conteúdo da Central de Ajuda.
 *
 * Conteúdo é DADO (objeto), nunca JSX — é o que permite buscar por palavra,
 * filtrar por papel e reaproveitar o mesmo tópico em três lugares (lista,
 * resultado de busca e card "nesta tela") sem duplicar texto. Mesma decisão
 * já tomada em app/(dashboard)/configuracoes/config-search.tsx.
 *
 * Importado pelo CLIENTE — nada de prisma/server aqui dentro.
 */

import type { $Enums } from "@/app/generated/prisma/client";
import type { FeatureKey } from "@/lib/feature-usage/features";

export type HelpRole = $Enums.OrgRole;

/**
 * Resposta de GET /api/help/overview — mora aqui, e não no arquivo da rota,
 * pra o cliente nunca precisar importar um módulo de servidor só por causa
 * de um tipo.
 */
export type HelpOverview = {
  /** Ids da checklist já concluídos (o texto de cada um está em lib/help/checklist.ts). */
  done: string[];
  /** Ações medidas que esta pessoa nunca usou — alimenta o "Você sabia?". */
  neverUsed: FeatureKey[];
};

export type HelpCategoryId =
  | "primeiros-passos"
  | "produtividade"
  | "clientes"
  | "pipeline"
  | "whatsapp"
  | "agenda"
  | "relatorios"
  | "admin";

/** Botão que leva DIRETO pra tela (o pedido: ajuda que resolve, não que só explica). */
export type HelpLink = {
  label: string;
  href: string;
  /** Abre em outra aba (documentação da API, simulador) em vez de navegar por cima da ajuda. */
  newTab?: boolean;
};

export type HelpTopic = {
  id: string;
  title: string;
  /** Uma linha — é o que aparece na lista e no resultado de busca. */
  summary: string;
  category: HelpCategoryId;
  /** Chave de HELP_ICONS (components/help/help-icons.ts). */
  icon: string;
  /**
   * Sinônimos e termos que a pessoa digitaria sem acertar o título — é isso
   * que faz a busca parecer esperta num catálogo pequeno e fixo (ex.: digitar
   * "disparo" acha "Campanhas"). Mesmo mecanismo do ConfigSearch.
   */
  keywords?: string[];
  /** Passo a passo. Uma frase de AÇÃO por item, na ordem de fazer. */
  steps?: string[];
  /** Destaque no fim do tópico: um atalho que economiza tempo, ou um risco real. */
  note?: { kind: "tip" | "warn"; text: string };
  links?: HelpLink[];
  /** Tabela de referência (variáveis de script, atalhos de teclado). */
  reference?: { code: string; meaning: string }[];
  /** Tour guiado que aponta os elementos na tela de verdade (lib/help/tours.ts). */
  tourId?: string;
  /** Só esses papéis veem o tópico. Ausente = todo mundo. */
  roles?: HelpRole[];
  /** Esconde de quem é do Administrativo (pós-venda) — não opera o funil de vendas. */
  salesOnly?: boolean;
};

export type HelpCategory = {
  id: HelpCategoryId;
  title: string;
  /** Chave de HELP_ICONS. */
  icon: string;
};

/** Ajuda do "onde eu estou" — casada com a rota atual (lib/help/screens.ts). */
export type HelpScreen = {
  /** Título curto da tela, do jeito que a pessoa chama ("Pipeline", "Conversas"). */
  title: string;
  /** Uma frase: pra que serve esta tela. */
  purpose: string;
  /** Ids de HelpTopic mais úteis aqui, na ordem de utilidade. */
  topicIds: string[];
};

// ─── Tour guiado ────────────────────────────────────────────────────

export type HelpTourStep = {
  /**
   * Elemento real destacado na tela. Sempre um `[data-help="..."]` — atributo
   * explícito e greppável, nunca uma classe de layout (que muda com qualquer
   * ajuste de design e quebraria o tour em silêncio).
   *
   * Sem alvo (ou alvo não encontrado na tela) o passo continua valendo: vira
   * um card centralizado com o mesmo texto. O tour NUNCA trava por causa de
   * um elemento que mudou de lugar.
   */
  target?: string;
  title: string;
  body: string;
  /** Navega pra esta rota antes de mostrar o passo (e espera o elemento aparecer). */
  route?: string;
  /**
   * Passo que só faz sentido com o elemento na tela — some quando ele não
   * existe, em vez de virar card centralizado. É assim que o tour fica
   * certo por papel sem precisar saber de papel nenhum: quem é do
   * Administrativo não tem o botão "Novo negócio", então não ouve falar
   * dele. Avaliado UMA vez, ao iniciar o tour, então não combina com
   * `route` (o elemento ainda nem foi renderizado nessa hora).
   */
  requiresTarget?: boolean;
};

export type HelpTour = {
  id: string;
  title: string;
  steps: HelpTourStep[];
};
