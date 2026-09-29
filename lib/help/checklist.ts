import type { HelpLink } from "./types";

/**
 * "Primeiros passos" — o que precisa estar pronto pra pessoa conseguir
 * trabalhar de verdade no CRM.
 *
 * Cada item é verificado NO BANCO (ver app/api/help/overview/route.ts), nunca
 * marcado à mão: checklist que a pessoa marca sozinha vira teatro, e ninguém
 * volta pra desmarcar quando o WhatsApp cai. Feito de verdade = o dado existe.
 *
 * O card some inteiro quando tudo está feito — quem já configurou não precisa
 * ver uma lista de coisas prontas todo dia.
 */
export type ChecklistItemId = "foto" | "whatsapp" | "negocio" | "script" | "cartao";

export type ChecklistItem = {
  id: ChecklistItemId;
  title: string;
  /** Por que isso importa — nunca só "faça isso". */
  why: string;
  action: HelpLink;
  /** Tópico que explica com calma, pra quem quiser entender antes de fazer. */
  topicId: string;
  /** Não faz sentido pra quem é do Administrativo (pós-venda). */
  salesOnly?: boolean;
};

export const CHECKLIST_ITEMS: ChecklistItem[] = [
  {
    id: "whatsapp",
    title: "Conectar seu WhatsApp",
    why: "Sem isso, o CRM não envia nem recebe mensagem por você.",
    action: { label: "Conectar", href: "/configuracoes/perfil#whatsapp" },
    topicId: "conectar-whatsapp",
  },
  {
    id: "foto",
    title: "Colocar sua foto",
    why: "Aparece pro time nos negócios e no seu cartão de visita.",
    action: { label: "Enviar foto", href: "/configuracoes/perfil" },
    topicId: "perfil-foto",
  },
  {
    id: "negocio",
    title: "Registrar seu primeiro negócio",
    why: "É o negócio que anda pelo funil e aparece no relatório do mês.",
    action: { label: "Criar negócio", href: "/pipeline?novo=1" },
    topicId: "criar-negocio",
    salesOnly: true,
  },
  {
    id: "script",
    title: "Criar um script de mensagem",
    why: "Para de digitar a mesma abordagem e já personaliza com o nome do cliente.",
    action: { label: "Criar script", href: "/whatsapp/scripts/novo" },
    topicId: "scripts",
  },
  {
    id: "cartao",
    title: "Ativar seu cartão digital",
    why: "Um QR Code que entrega seu contato pro cliente na hora.",
    action: { label: "Abrir cartão", href: "/configuracoes/meu-cartao" },
    topicId: "cartao-digital",
  },
];
