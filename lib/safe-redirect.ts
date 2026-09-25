/**
 * Destino de redirecionamento vindo da URL/cookie ("voltar pra onde a pessoa
 * estava") — só aceita caminho INTERNO do próprio app, nunca site de fora.
 *
 * Achado do relatório de QA (teste pendente "open redirect no OAuth"): o filtro
 * antigo de /api/google-calendar/authorize barrava "//evil.com" e "\", mas
 * `redirect=/%09/evil.com` PASSAVA — o valor decodificado é "/\t/evil.com", que
 * não começa com "//"; o parser de URL do padrão WHATWG, porém, REMOVE tab, LF
 * e CR da entrada, então `new URL("/\t/evil.com", base)` vira `https://evil.com/`
 * (reproduzido em teste). Blocklist de casos conhecidos não fecha isso; aqui é
 * ALLOWLIST: começa com UMA barra e só tem caracteres seguros de caminho
 * (letras, dígitos, `-._~%`, `/`, e `?=&#` pra query/âncora). Espaço, tab, quebra
 * de linha, barra invertida, `:` e `@` ficam de fora — não há motivo pra um
 * destino interno legítimo do app tê-los.
 */
const SAFE_INTERNAL_PATH = /^\/(?!\/)[A-Za-z0-9\-._~%/?=&#]*$/;

export function safeInternalPath(value: string | null | undefined): string | null {
  if (!value || value.length > 300) return null;
  return SAFE_INTERNAL_PATH.test(value) ? value : null;
}

/**
 * Defesa em profundidade pra quem monta a URL final com `new URL(path, base)`:
 * mesmo com o caminho já validado, confere que o resultado continua na origem
 * do app. Se, por qualquer motivo, escapar, devolve o destino padrão.
 */
export function resolveInternalRedirect(path: string | null | undefined, base: string, fallback: string): URL {
  const baseUrl = new URL(base);
  const candidate = safeInternalPath(path);
  if (candidate) {
    try {
      const url = new URL(candidate, baseUrl);
      if (url.origin === baseUrl.origin) return url;
    } catch {
      // cai no fallback
    }
  }
  return new URL(fallback, baseUrl);
}
