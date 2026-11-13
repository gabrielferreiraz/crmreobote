/**
 * Áreas de atuação (OrganizationUser.area) — como a corretora trabalha:
 *  - VENDAS: prospecta, vende a carta de crédito e fecha o Ganho.
 *  - ADMINISTRATIVO: cadastra a cota na administradora (dados + documentos).
 *  - FINANCEIRO: confere o pagamento das parcelas e cuida das comissões.
 *  - POS_CONTEMPLACAO: cuida dos processos depois que o cliente é contemplado.
 * Tudo que não é VENDAS é "retaguarda": não usa o pipeline de vendas.
 */

export type AreaValue = "VENDAS" | "ADMINISTRATIVO" | "FINANCEIRO" | "POS_CONTEMPLACAO";

export const AREA_OPTIONS: { value: AreaValue; label: string; hint: string }[] = [
  { value: "VENDAS", label: "Vendas", hint: "Prospecta e vende" },
  { value: "ADMINISTRATIVO", label: "Administrativo", hint: "Cadastra a cota e pede documentos" },
  { value: "FINANCEIRO", label: "Financeiro", hint: "Parcelas e comissões" },
  { value: "POS_CONTEMPLACAO", label: "Pós-contemplação", hint: "Processos do cliente contemplado" },
];

export const AREA_LABELS: Record<AreaValue, string> = {
  VENDAS: "Vendas",
  ADMINISTRATIVO: "Administrativo",
  FINANCEIRO: "Financeiro",
  POS_CONTEMPLACAO: "Pós-contemplação",
};

export function isValidArea(v: unknown): v is AreaValue {
  return v === "VENDAS" || v === "ADMINISTRATIVO" || v === "FINANCEIRO" || v === "POS_CONTEMPLACAO";
}

/** Retaguarda = qualquer área que não vende. */
export function isBackOfficeArea(area: string | null | undefined): boolean {
  return area != null && area !== "VENDAS";
}
