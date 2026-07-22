export type DocumentStatus = "NOT_REQUESTED" | "PENDING_DELIVERY" | "DELIVERED";

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  NOT_REQUESTED: "Falta pedir documentação",
  PENDING_DELIVERY: "Documentação pendente de entrega",
  DELIVERED: "Documentação entregue",
};

export const DOCUMENT_STATUS_BADGE: Record<DocumentStatus, string> = {
  NOT_REQUESTED:
    "border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400",
  PENDING_DELIVERY:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-400",
  DELIVERED:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400",
};
