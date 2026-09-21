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
 * Capa e avatar ficam `null` até ter uma foto que faça sentido mostrar pra
 * todo mundo (capa é enquadramento específico demais pra reaproveitar;
 * avatar nunca pode ser o rosto de outra pessoa, ver comentário abaixo) —
 * nesse caso components/digital-card/digital-card-view.tsx usa o gradiente
 * abstrato ou o ícone genérico de pessoa como fallback final, nunca um
 * placeholder inventado. Fundo já tem uma foto real (ambientação da
 * empresa, não identidade de ninguém — ver DEFAULT_BACKGROUND_PHOTO_URL).
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

/**
 * Fundo do CORPO INTEIRO do cartão (atrás dos botões/ícones/rodapé) —
 * imagem distinta da capa acima (atrás só do avatar). Diferente do avatar
 * (ver DEFAULT_AVATAR_URL abaixo): isto NÃO é a identidade de uma pessoa,
 * é ambientação/marca da empresa — pedido explícito: "a foto de fundo da
 * reobote... essa sim deve ser vista por todos os usuários". Mostrar o
 * mesmo fundo pra todo mundo que não subiu um próprio não é enganoso do
 * jeito que mostrar o rosto de outra pessoa seria.
 */
export const DEFAULT_BACKGROUND_PHOTO_URL: string | null = "/card-defaults/background.png";

/**
 * Avatar padrão pra quem ainda não subiu foto própria NEM tem foto de
 * perfil no CRM (User.image) — nunca sobrescreve uma foto real que já
 * exista. `null` de propósito: cada cartão é de UMA pessoa específica, e
 * mostrar o rosto de outra (mesmo o dono da organização) no cartão de quem
 * ainda não subiu foto é enganoso, não "um padrão genérico" — decisão
 * revertida depois de constatado em produção (ver git blame; a versão
 * anterior usava a foto do dono como padrão pra todo mundo, pedido
 * explícito de correção: "cada foto deve ser do usuário logado"). Sem
 * foto real, components/digital-card/digital-card-view.tsx cai no ícone
 * genérico de pessoa — nunca inventa uma foto de alguém que não é o dono
 * DAQUELE cartão.
 */
export const DEFAULT_AVATAR_URL: string | null = null;
