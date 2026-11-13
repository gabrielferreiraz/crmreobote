/**
 * Avisa o servidor que o administrativo abriu um documento ou copiou dados do cliente,
 * para entrar na auditoria da venda. Nunca envia o conteúdo copiado — só o nome do dado.
 * Falha em silêncio: a auditoria de acesso não pode atrapalhar o trabalho.
 */
export type DealAccessEvent = { event: "doc_viewed"; docId: string } | { event: "data_copied"; what: string };

export function trackDealAccess(dealId: string, body: DealAccessEvent): void {
  void fetch(`/api/deals/${dealId}/audit/access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}
