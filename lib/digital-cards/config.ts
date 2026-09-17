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
 * Quando uma foto chega: sobe como arquivo estático em
 * public/card-defaults/ (mesmo padrão das logos parceiras, ver
 * lib/digital-cards/logos.ts — prefixo próprio liberado em PUBLIC_PATHS,
 * lib/auth.config.ts, já que a raiz de public/ exige sessão) e cola o
 * caminho aqui — usado DIRETO como string, nunca passa por
 * resolveAvatarUrl (isto já é a URL pública final, não uma chave do bucket
 * privado do R2) — não precisa de upload/formulário pra isto, são
 * constantes da organização inteira, não algo que muda por request.
 */
export const DEFAULT_COVER_PHOTO_URL: string | null = null;

/** Fundo do CORPO INTEIRO do cartão (atrás dos botões/ícones/rodapé) — imagem distinta da capa acima (atrás só do avatar). */
export const DEFAULT_BACKGROUND_PHOTO_URL: string | null = null;

/**
 * Avatar padrão pra quem ainda não subiu foto própria NEM tem foto de
 * perfil no CRM (User.image) — nunca sobrescreve uma foto real que já
 * exista. Pedido explícito: "a foto também, a que eu coloquei como dono
 * deve vir como padrão" — a foto que o dono da organização subiu no
 * próprio cartão (photoKey) virou o padrão pra todo mundo que ainda não
 * tem uma própria.
 */
export const DEFAULT_AVATAR_URL: string | null = "/card-defaults/avatar.png";
