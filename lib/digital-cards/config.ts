/**
 * Padrão "DE FÁBRICA" do Cartão Digital — hardcoded, só muda com deploy.
 * Usado quando o cartão não tem foto própria NEM a organização configurou
 * um padrão pelo botão "Manter padrão para todos" (ver
 * lib/digital-cards/org-defaults.ts — camada acima desta, editável em
 * produção pelo OWNER, sem precisar de deploy).
 *
 * Ordem de fallback SEMPRE (ver lib/digital-cards/queries.ts, enrichCard):
 * override do próprio cartão → padrão escolhido pelo dono (org-defaults) →
 * este padrão de fábrica → gradiente abstrato/ícone genérico. Cada
 * consultor pode sobrescrever a qualquer momento (upload em "Meu Cartão") e
 * remover pra voltar exatamente a um desses padrões, nunca um placeholder
 * inventado.
 *
 * Quando uma foto de fábrica chega: sobe como arquivo estático em
 * public/card-defaults/ (mesmo padrão das logos parceiras, ver
 * lib/digital-cards/logos.ts — prefixo próprio liberado em PUBLIC_PATHS,
 * lib/auth.config.ts, já que a raiz de public/ exige sessão) e cola o
 * caminho aqui — usado DIRETO como string, nunca passa por
 * resolveAvatarUrl (isto já é a URL pública final, não uma chave do bucket
 * privado do R2).
 */
export const DEFAULT_COVER_PHOTO_URL: string | null = "/card-defaults/cover.png";

/**
 * Fundo do CORPO INTEIRO do cartão (atrás dos botões/ícones/rodapé) —
 * imagem distinta da capa acima (atrás só do avatar). `null` de fábrica: a
 * única foto que a empresa tinha pronta (ambientação do escritório) é a
 * capa acima — ninguém enviou ainda uma foto pensada especificamente pra
 * cobrir o corpo inteiro do cartão. Sem foto, cai pro gradiente abstrato
 * escuro de sempre (nunca um placeholder inventado). O OWNER pode definir
 * um padrão sem precisar de deploy — ver lib/digital-cards/org-defaults.ts.
 */
export const DEFAULT_BACKGROUND_PHOTO_URL: string | null = null;

/**
 * Avatar padrão pra quem ainda não subiu foto própria NEM tem foto de
 * perfil no CRM (User.image) — nunca sobrescreve uma foto real que já
 * exista. `null` de propósito: cada cartão é de UMA pessoa específica, e
 * mostrar o rosto de outra (mesmo o dono da organização) no cartão de quem
 * ainda não subiu foto é enganoso, não "um padrão genérico" — decisão
 * revertida depois de constatado em produção (ver git blame; a versão
 * anterior usava a foto do dono como padrão pra todo mundo, pedido
 * explícito de correção: "cada foto deve ser do usuário logado"). Isto
 * inclui o padrão do OWNER (org-defaults) — o botão "Manter padrão para
 * todos" também não existe pro avatar, só capa/fundo (ver card-editor.tsx),
 * exatamente pelo mesmo motivo. Sem foto real,
 * components/digital-card/digital-card-view.tsx cai no ícone genérico de
 * pessoa.
 */
export const DEFAULT_AVATAR_URL: string | null = null;
