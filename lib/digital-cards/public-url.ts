/**
 * Monta a URL pública permanente do cartão (/c/[slug]) — usa
 * CARD_PUBLIC_BASE_URL (ex.: "https://cartao.reobote.com.br") quando
 * configurado; sem essa env var, cai pro `origin` passado por quem chama
 * (Route Handler: `new URL(req.url).origin`; Server Component: montado a
 * partir dos headers x-forwarded-proto/host, ver publicCardUrlFromHeaders
 * abaixo), então o cartão já funciona no domínio atual do CRM antes do
 * subdomínio próprio existir (ver decisão no plano — DNS/reverse proxy é
 * passo de infra, fora do meu alcance daqui).
 */
export function publicCardUrl(slug: string, origin?: string): string {
  const base = process.env.CARD_PUBLIC_BASE_URL || origin || "";
  return `${base}/c/${slug}`;
}

/** Mesmo que publicCardUrl, mas resolvendo o origin a partir dos headers da requisição — pra uso em Server Component, que não tem um `Request` à mão (ver app/c/[slug]/page.tsx). */
export function publicCardUrlFromHeaders(slug: string, headers: Headers): string {
  if (process.env.CARD_PUBLIC_BASE_URL) return publicCardUrl(slug);
  const proto = headers.get("x-forwarded-proto") ?? "https";
  const host = headers.get("host") ?? "";
  return publicCardUrl(slug, host ? `${proto}://${host}` : undefined);
}
