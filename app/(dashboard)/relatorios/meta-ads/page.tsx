import { redirect } from "next/navigation";

/**
 * Essa página virou a aba "Facebook" de /relatorios (ver
 * relatorios/meta-ads-view.tsx e relatorios/report-tabs.tsx) — link antigo
 * mantido funcionando via redirect, caso alguém tenha essa URL salva.
 */
export default function MetaAdsAttributionRedirect() {
  redirect("/relatorios?view=facebook");
}
