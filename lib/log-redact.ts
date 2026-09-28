/**
 * Redação de dado sensível ANTES de ir pro log (auditoria de 09/2026, P0).
 *
 * Os logs do container (EasyPanel) são lidos por quem administra a VPS, ficam
 * guardados e às vezes são copiados em chamado de suporte. Até 09/2026 eles
 * recebiam: token de acesso da Meta (resposta de /oauth/access_token), o App
 * Secret e o código OAuth (na query string do path), QR/pareamento e token da
 * instância do Evolution (toda resposta de sucesso era logada), a URL do
 * webhook com o segredo, e telefones/JIDs de lead. Regra daqui pra frente:
 *  - resposta de API de terceiro NUNCA é logada inteira em caso de sucesso;
 *  - URL/path passa por redactUrl; objeto por redactForLog; telefone por maskPhone.
 */

const SENSITIVE_KEY = /(token|secret|password|passwd|apikey|api_key|authorization|code|hash|qrcode|qr_code|base64|pairing|signature|cookie)/i;

/** "5567999998888" → "*********8888"; aceita JID ("5567...@s.whatsapp.net"). */
export function maskPhone(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/\d{6,}/g, (digits) => `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`);
}

/** Troca o VALOR de parâmetros sensíveis da query por "***" (client_secret, code, access_token, fb_exchange_token, secret…). */
export function redactUrl(url: string): string {
  const q = url.indexOf("?");
  if (q < 0) return url;
  const base = url.slice(0, q);
  const params = new URLSearchParams(url.slice(q + 1));
  for (const key of Array.from(params.keys())) {
    if (SENSITIVE_KEY.test(key)) params.set(key, "***");
  }
  // URLSearchParams escaparia "***" — reconstrói à mão pra ficar legível.
  const query = Array.from(params.entries())
    .map(([k, v]) => `${k}=${v === "***" ? v : encodeURIComponent(v)}`)
    .join("&");
  return `${base}?${query}`;
}

/** Cópia do objeto com chaves sensíveis mascaradas, telefones mascarados e textos longos cortados — pra log de ERRO, nunca de sucesso. */
export function redactForLog(value: unknown, maxLength = 500): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 6) return "[…]";
    if (typeof v === "string") return maskPhone(v.length > 200 ? `${v.slice(0, 200)}…` : v);
    if (!v || typeof v !== "object") return v;
    if (seen.has(v as object)) return "[circular]";
    seen.add(v as object);
    if (Array.isArray(v)) return v.slice(0, 20).map((x) => walk(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      // Número (ex.: error.code 190 da Meta, error_subcode) é código de erro, útil
      // pra diagnóstico — o que é segredo aqui é sempre texto (token, code OAuth).
      const secret = SENSITIVE_KEY.test(k) && val !== null && val !== undefined && typeof val !== "number" && typeof val !== "boolean";
      out[k] = secret ? "***" : walk(val, depth + 1);
    }
    return out;
  };
  let text: string;
  try {
    text = JSON.stringify(walk(value, 0)) ?? String(value);
  } catch {
    text = "[não serializável]";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
