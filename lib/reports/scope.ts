/**
 * Quem lê o relatório comercial da organização INTEIRA, sem ser Dono.
 *
 * A área Administrativo acompanha os resultados de vendas de todo o time
 * (pedido do dono, 10/11): vê a página Comercial completa, só para leitura.
 * Meta, ranking e demais ajustes continuam sendo do Dono: a pessoa NÃO vira
 * Dono nem herda outro acesso — é só o recorte dos números que se amplia.
 * Consultor, Supervisor e Gerente continuam com o escopo do próprio papel
 * (ver getDealScope em lib/team-scope.ts).
 */
export function seesOrganizationWideCommercialReport(area: string | null | undefined): boolean {
  return area === "ADMINISTRATIVO";
}
