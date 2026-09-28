/**
 * Chamada de API do lado do cliente que NUNCA falha em silêncio (auditoria
 * 09/2026): várias telas faziam `await fetch(...)` e seguiam como se tivesse
 * dado certo — um 403/404/500 (ou a internet caindo) deixava a tela dizendo
 * "salvo" sem ter salvo nada, ou um botão girando pra sempre.
 *
 * `requestJson` resolve sempre (nunca lança): devolve `{ ok, data }` ou
 * `{ ok: false, error }` e, por padrão, já mostra o motivo num aviso vermelho
 * no canto da tela (ver ErrorToasts em components/undo-provider.tsx). A
 * mensagem é a que o servidor mandou (`{ error: "..." }`, padrão das rotas
 * deste projeto) — só cai numa genérica quando o servidor não explicou.
 *
 * `showErrorToast` também pode ser chamado direto, de qualquer lugar do
 * cliente (não é hook — funciona em callback, em loop, fora de componente).
 */

type ErrorListener = (message: string) => void;
const listeners = new Set<ErrorListener>();

export function subscribeErrorToast(listener: ErrorListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function showErrorToast(message: string) {
  if (listeners.size === 0) {
    // Fora do dashboard (sem o provider montado) — pelo menos não some.
    console.error(message);
    return;
  }
  for (const listener of listeners) listener(message);
}

export const NETWORK_ERROR_MESSAGE = "Sem conexão com o servidor — confira a internet e tente de novo.";

function messageForStatus(status: number): string {
  if (status === 401) return "Sua sessão expirou — entre de novo.";
  if (status === 403) return "Você não tem permissão para fazer isso.";
  if (status === 404) return "Não encontrado — pode ter sido removido por outra pessoa.";
  if (status === 409) return "Conflito com uma alteração feita por outra pessoa — atualize a página.";
  if (status === 413) return "Arquivo ou conteúdo grande demais.";
  if (status === 429) return "Muitas tentativas seguidas — espere um instante e tente de novo.";
  if (status >= 500) return "Erro no servidor — tente de novo em instantes.";
  return "Não foi possível concluir a ação.";
}

// `data` tipado como `any` de propósito no caso de sucesso: cada rota tem seu
// formato e os chamadores já tratavam `await res.json()` como `any`.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type RequestResult<T = any> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; data: any; error: string };

export async function requestJson<T = any>(
  url: string,
  init?: RequestInit & { json?: unknown },
  opts?: {
    /** Mensagem própria quando o servidor não mandou `error`. */
    errorMessage?: string;
    /** true = não mostra aviso (o chamador exibe o erro do seu jeito, ex.: dentro do formulário). */
    silent?: boolean;
  },
): Promise<RequestResult<T>> {
  const { json, ...rest } = init ?? {};
  const requestInit: RequestInit =
    json === undefined
      ? rest
      : { ...rest, headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) }, body: JSON.stringify(json) };

  let res: Response;
  try {
    res = await fetch(url, requestInit);
  } catch {
    if (!opts?.silent) showErrorToast(NETWORK_ERROR_MESSAGE);
    return { ok: false, status: 0, data: null, error: NETWORK_ERROR_MESSAGE };
  }

  const data: any = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.ok) return { ok: true, status: res.status, data: data as T };

  const serverError = data && typeof data.error === "string" && data.error.trim() ? data.error : null;
  const error = serverError ?? opts?.errorMessage ?? messageForStatus(res.status);
  if (!opts?.silent) showErrorToast(error);
  return { ok: false, status: res.status, data, error };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
