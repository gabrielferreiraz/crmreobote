/**
 * Tipos, rótulos e regras PURAS de Proposta — separado de qualquer arquivo
 * que importe prisma de propósito (mesmo padrão de lib/contacts/constants.ts
 * vs. list-query.ts e lib/notification-settings-constants.ts): componente
 * "use client" precisa importar isto sem arrastar `pg` pro bundle do
 * navegador.
 */

export type ProposalStatus = "DRAFT" | "GENERATED" | "SENT" | "ACCEPTED" | "DECLINED" | "SUPERSEDED" | "CANCELLED";

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  DRAFT: "Rascunho",
  GENERATED: "Gerada",
  SENT: "Enviada",
  ACCEPTED: "Aceita",
  DECLINED: "Recusada",
  SUPERSEDED: "Refeita",
  CANCELLED: "Cancelada",
};

/** Classes de cor do selo de status — mesmas famílias já usadas em STATUS_TONE de campanhas (recipients-table.tsx). */
export const PROPOSAL_STATUS_TONE: Record<ProposalStatus, string> = {
  DRAFT: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  GENERATED: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
  SENT: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  ACCEPTED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  DECLINED: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
  SUPERSEDED: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400",
  CANCELLED: "bg-neutral-100 text-neutral-400 line-through dark:bg-neutral-800 dark:text-neutral-500",
};

/**
 * Serializável pra Client Component (Decimal do Prisma NÃO atravessa a
 * fronteira servidor→cliente do Next — ver serializeProposal em
 * lib/proposals/queries.ts, que converte tudo pra number/ISO string).
 */
export type ProposalDTO = {
  id: string;
  dealId: string;
  number: number;
  revision: number;
  parentId: string | null;
  status: ProposalStatus;
  /** Sempre o TOTAL — "por cota" é derivado (ver creditPerQuota). */
  credit: number;
  termMonths: number;
  installment: number;
  quotaCount: number;
  description: string;
  createdById: string;
  createdByName: string;
  sentById: string | null;
  sentByName: string | null;
  generatedAt: string | null;
  sentAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

/**
 * Tudo que o documento impresso mostra (ver components/proposals/
 * proposal-document.tsx e getProposalPrintData em lib/proposals/queries.ts).
 * Vive aqui (não em queries.ts) porque o documento é componente de cliente e
 * queries.ts importa prisma.
 */
export type ProposalPrintData = {
  proposal: ProposalDTO;
  dealName: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  /** Tipo de crédito do NEGÓCIO (Imóvel/Automóvel/...) — informação extra no documento quando preenchida. */
  creditType: string | null;
  /** Quem enviou (se já enviada) ou, antes disso, quem criou — nome que aparece no documento e não muda depois de SENT. */
  consultantName: string;
  consultantEmail: string | null;
  organizationName: string;
};

/** "Nº 000142" — zero-padded, sempre 6 dígitos (passa disso, só cresce). */
export function formatProposalNumber(n: number): string {
  return String(n).padStart(6, "0");
}

/** Crédito por cota, sempre derivado (nunca guardado — ver comentário em Proposal.credit no schema). */
export function creditPerQuota(credit: number, quotaCount: number): number {
  if (!quotaCount || quotaCount <= 0) return 0;
  return credit / quotaCount;
}

/**
 * Campos comerciais (crédito/prazo/parcela/cotas/descrição) só podem mudar
 * ANTES de a proposta ser marcada como enviada — depois disso ela é registro
 * do que o cliente de fato recebeu, mudar retroativamente reescreveria o
 * histórico (e o relatório). Pra alterar depois de enviada: "Refazer" (cria
 * revisão nova, ver redoProposal em lib/proposals/service.ts).
 * GENERATED continua editável de propósito: gerar o documento não prova que
 * saiu da mão do consultor (ver comentário de Proposal.generatedAt no schema).
 */
export function isProposalEditable(status: ProposalStatus): boolean {
  return status === "DRAFT" || status === "GENERATED";
}

/** Só rascunho nunca-gerado pode ser apagado de verdade — qualquer outro estado vira CANCELLED e a linha permanece. */
export function isProposalDeletable(status: ProposalStatus): boolean {
  return status === "DRAFT";
}

/** Estados em que a proposta ainda "está viva" (não chegou a um desfecho terminal). */
export function isProposalOpen(status: ProposalStatus): boolean {
  return status === "DRAFT" || status === "GENERATED" || status === "SENT";
}

export type ProposalAction = "generate" | "send" | "accept" | "decline" | "redo" | "cancel" | "edit" | "delete" | "duplicate";

/** Ações que a UI oferece por estado — fonte única pra tela E servidor validarem a mesma coisa. */
export function allowedProposalActions(status: ProposalStatus): ProposalAction[] {
  switch (status) {
    case "DRAFT":
      // Sem "cancel": rascunho nunca-gerado simplesmente se apaga (delete) —
      // cancelar seria só uma segunda forma de descartar a mesma coisa.
      return ["edit", "generate", "delete"];
    case "GENERATED":
      return ["edit", "generate", "send", "cancel"];
    case "SENT":
      return ["accept", "decline", "redo", "cancel"];
    case "DECLINED":
      // Cliente recusou mas pode voltar pedindo outra condição — nova
      // proposta a partir desta, sem mexer no estado da recusada.
      return ["duplicate"];
    case "ACCEPTED":
    case "SUPERSEDED":
    case "CANCELLED":
      return [];
  }
}
