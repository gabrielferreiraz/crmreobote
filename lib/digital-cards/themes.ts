/**
 * Temas do Cartão Digital — pedido explícito: "adicionar uma ação pra o
 * usuário escolher se ele quer tema claro, tema escuro ou colocar a foto no
 * fundo".
 *
 * - DARK: o comportamento de sempre (fundo escuro #090d16) — também é o
 *   fallback final de tudo.
 * - LIGHT: um azul bem claro e quase transparente (glassmorphism), texto
 *   escuro.
 * - PHOTO: a foto de fundo cobre o cartão inteiro com um scrim escuro LEVE
 *   por cima (foto em destaque, texto branco).
 *
 * Guardado em DigitalCard.theme (coluna opcional, ver schema) — null = a
 * pessoa nunca escolheu, aí vale o padrão da ORGANIZAÇÃO
 * (Organization.digitalCardDefaults.theme, "Manter este tema padrão para
 * todos" em card-editor.tsx, OWNER-only) e, se a org também não definiu, o
 * de fábrica (DEFAULT_CARD_THEME).
 *
 * Módulo DOMÍNIO puro, sem import de prisma/sharp/pg de propósito — é
 * importado por componentes "use client" (card-editor.tsx,
 * digital-card-view.tsx), mesmo motivo documentado em lib/phone-normalize.ts.
 */
export const CARD_THEMES = ["DARK", "LIGHT", "PHOTO"] as const;

export type CardTheme = (typeof CARD_THEMES)[number];

/** Padrão de fábrica — idêntico ao comportamento anterior a esta feature. */
export const DEFAULT_CARD_THEME: CardTheme = "DARK";

export const CARD_THEME_LABELS: Record<CardTheme, string> = {
  DARK: "Escuro",
  LIGHT: "Tema claro",
  PHOTO: "Foto no fundo",
};

/** Guarda contra JSON arbitrário vindo de Organization.digitalCardDefaults e contra corpo de request. */
export function isCardTheme(value: unknown): value is CardTheme {
  return typeof value === "string" && (CARD_THEMES as readonly string[]).includes(value);
}

/**
 * Tema efetivo de um cartão: escolha própria → padrão da organização →
 * de fábrica. `orgDefault` chega de um campo Json, por isso `unknown` +
 * isCardTheme (um valor corrompido nunca quebra a renderização, só cai no
 * DARK).
 */
export function resolveCardTheme(own: CardTheme | null | undefined, orgDefault: unknown): CardTheme {
  if (own && isCardTheme(own)) return own;
  if (isCardTheme(orgDefault)) return orgDefault;
  return DEFAULT_CARD_THEME;
}
