import type { ProposalDTO } from "./types";
import type { ProposalFields } from "./validate";

/**
 * Chamadas às rotas de Proposta a partir do navegador — um lugar só pra
 * tratar erro de rede/corpo inesperado (cartão do negócio, formulário e
 * barra da página de impressão usam as mesmas), sempre devolvendo
 * `{ ok, ... }` em vez de lançar, pra tela mostrar a mensagem do servidor
 * ("a proposta mudou de estado enquanto você olhava...") sem try/catch em
 * cada botão.
 */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data as { error?: string }).error ?? `Erro ${res.status}` };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Falha de conexão. Tente novamente." };
  }
}

export type ProposalActionName = "generate" | "send" | "accept" | "decline" | "redo" | "cancel";

export const proposalApi = {
  create: (dealId: string, fields: ProposalFields) =>
    call<ProposalDTO>(`/api/deals/${dealId}/proposals`, { method: "POST", body: JSON.stringify(fields) }),

  /** Nova proposta a partir de uma RECUSADA (copia os valores). */
  createFrom: (dealId: string, fromProposalId: string) =>
    call<ProposalDTO>(`/api/deals/${dealId}/proposals`, { method: "POST", body: JSON.stringify({ fromProposalId }) }),

  update: (id: string, fields: ProposalFields) =>
    call<ProposalDTO>(`/api/proposals/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),

  remove: (id: string) => call<{ id: string }>(`/api/proposals/${id}`, { method: "DELETE" }),

  action: <T = ProposalDTO>(id: string, action: ProposalActionName) =>
    call<T>(`/api/proposals/${id}/${action}`, { method: "POST", body: "{}" }),
};
