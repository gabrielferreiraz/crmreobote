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

/**
 * Cancelamento NÃO é erro. Quando a tela é desmontada no meio de uma busca
 * (clicou em Clientes, não esperou carregar e foi pra Pipeline), o
 * AbortController derruba a requisição e o `fetch` rejeita com AbortError —
 * que, sem este reconhecimento, cairia no catch genérico e mostraria
 * "Sem conexão com o servidor" em vermelho pra quem só trocou de página.
 *
 * Checa pelo `name` em vez de `instanceof DOMException`: o motivo do abort
 * pode vir como DOMException (navegador), como Error comum (polyfill/jsdom)
 * ou como o `reason` passado pra abort(), e todos carregam name "AbortError".
 */
export function isAbortError(err: unknown): boolean {
  return !!err && typeof err === "object" && "name" in err && (err as { name?: unknown }).name === "AbortError";
}

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
  | { ok: true; status: number; data: T; aborted?: false }
  // `aborted: true` = a própria tela cancelou (trocou de página, mudou o
  // filtro antes de a busca anterior voltar) — não é erro, e nunca vira aviso
  // vermelho. Ver isAbortError acima.
  | { ok: false; status: number; data: any; error: string; aborted?: boolean };

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
  } catch (err) {
    // Cancelado pela própria tela (ver isAbortError) — devolve calado, sem
    // aviso vermelho: quem cancelou foi o usuário trocando de página, não a
    // internet caindo.
    if (isAbortError(err)) return { ok: false, status: 0, data: null, error: "cancelado", aborted: true };
    if (!opts?.silent) showErrorToast(NETWORK_ERROR_MESSAGE);
    return { ok: false, status: 0, data: null, error: NETWORK_ERROR_MESSAGE };
  }

  const data: any = res.status === 204 ? null : await res.json().catch(() => null);
  // O corpo também pode ser cortado no meio da leitura quando o abort chega
  // depois dos headers — aí o .catch acima devolve null e, sem esta
  // checagem, a tela receberia `{ ok: true, data: null }` e trataria o
  // cancelamento como "o servidor respondeu vazio".
  if (requestInit.signal?.aborted) return { ok: false, status: res.status, data: null, error: "cancelado", aborted: true };
  if (res.ok) return { ok: true, status: res.status, data: data as T };

  const serverError = data && typeof data.error === "string" && data.error.trim() ? data.error : null;
  const error = serverError ?? opts?.errorMessage ?? messageForStatus(res.status);
  if (!opts?.silent) showErrorToast(error);
  return { ok: false, status: res.status, data, error };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
