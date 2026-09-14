/**
 * Imagens padrão do Cartão Digital — usadas quando o cartão não tem uma
 * própria (ver DigitalCard.coverPhotoKey/backgroundPhotoKey e User.image no
 * schema). Pedido explícito: "essas [imagens] a gente vai deixar como
 * padrão pra todos, mas claro todos podem remover e colocar uma nova foto,
 * mas pode voltar ao padrão" — cada consultor pode sobrescrever a qualquer
 * momento (upload em "Meu Cartão") e remover pra voltar exatamente a isto
 * aqui (ver lib/digital-cards/queries.ts, a ordem de fallback é sempre
 * override do cartão → este padrão → gradiente/ícone genérico).
 *
 * Ficam `null` até as fotos reais chegarem — nesse caso
 * components/digital-card/digital-card-view.tsx usa o gradiente abstrato
 * (capa/fundo) ou um ícone genérico de pessoa (avatar) como fallback final,
 * nunca um placeholder inventado.
 *
 * Quando as fotos chegarem: subir pro bucket público do R2 (mesmo padrão de
 * `uploadTvAd`/logos parceiras, ver lib/r2.ts) e colar a URL pública aqui —
 * não precisa de upload/formulário pra isto, são constantes da organização
 * inteira, não algo que muda por request.
 */
export const DEFAULT_COVER_PHOTO_URL: string | null = null;

/** Fundo do CORPO INTEIRO do cartão (atrás dos botões/ícones/rodapé) — imagem distinta da capa acima (atrás só do avatar). */
export const DEFAULT_BACKGROUND_PHOTO_URL: string | null = null;

/** Avatar padrão pra quem ainda não subiu foto própria NEM tem foto de perfil no CRM (User.image) — nunca sobrescreve uma foto real que já exista. */
export const DEFAULT_AVATAR_URL: string | null = null;
