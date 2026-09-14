/**
 * Foto de capa padrão do Cartão Digital (usada quando o cartão não tem uma
 * própria em DigitalCard.coverPhotoKey) — pedido explícito depois da
 * conversa sobre a ideia do Gemini: "temos uma foto, vou mandar". Fica
 * `null` até a foto real chegar (nesse caso components/digital-card/
 * digital-card-view.tsx usa o gradiente abstrato como fallback final —
 * nunca um placeholder inventado).
 *
 * Quando a foto chegar: subir pro bucket público do R2 (mesmo padrão de
 * `uploadTvAd`/logos parceiras, ver lib/r2.ts) e colar a URL pública aqui —
 * não precisa de upload/formulário pra isto, é uma constante da
 * organização inteira, não algo que muda por request.
 */
export const DEFAULT_COVER_PHOTO_URL: string | null = null;
