import type { $Enums } from "@/app/generated/prisma/client";

export const TIP_PRIORITY: Record<ProductivityTipType, number> = {
  WHATSAPP_DISCONNECTED: 1000,
  NOSHOW_DEALS: 900,
  MANY_WHATSAPP_TASKS: 800,
  STALE_DEALS: 700,
  NO_MESSAGE_SCRIPTS: 600,
};

export const TIP_APPLIES_ON: Record<ProductivityTipType, "GLOBAL" | "PIPELINE" | "AGENDA"> = {
  WHATSAPP_DISCONNECTED: "GLOBAL",
  NOSHOW_DEALS: "PIPELINE",
  MANY_WHATSAPP_TASKS: "AGENDA",
  STALE_DEALS: "PIPELINE",
  NO_MESSAGE_SCRIPTS: "GLOBAL",
};

export type ProductivityTipType = $Enums.ProductivityTipType;

export type TipPayload =
  | { type: "WHATSAPP_DISCONNECTED" }
  | {
      type: "NOSHOW_DEALS";
      stageId: string;
      stageName: string;
      count: number;
      safeBatch: number;
      dealIdsAll: string[];
    }
  | {
      type: "MANY_WHATSAPP_TASKS";
      todayCount: number;
      weekCount: number;
      unscheduledIds: string[];
    }
  | { type: "STALE_DEALS"; stageId: string; count: number }
  | { type: "NO_MESSAGE_SCRIPTS" };

export type EvaluatedTip = {
  tipType: ProductivityTipType;
  scope: string;
  priority: number;
  payload: TipPayload;
};
