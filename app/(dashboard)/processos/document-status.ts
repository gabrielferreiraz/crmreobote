import type { BadgeTone } from "@/components/badge";

export type DocumentStatus = "NOT_REQUESTED" | "PENDING_DELIVERY" | "DELIVERED";

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  NOT_REQUESTED: "Falta pedir documentação",
  PENDING_DELIVERY: "Documentação pendente de entrega",
  DELIVERED: "Documentação entregue",
};

// Tons do Badge compartilhado (components/badge.tsx) — mesmo verde/âmbar/
// cinza usado em qualquer outro "isto está ok/pendente/neutro" do sistema.
export const DOCUMENT_STATUS_TONE: Record<DocumentStatus, BadgeTone> = {
  NOT_REQUESTED: "neutral",
  PENDING_DELIVERY: "warning",
  DELIVERED: "success",
};
