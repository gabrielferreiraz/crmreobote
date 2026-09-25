import { prisma } from "@/lib/prisma";
import { isCardTheme, type CardTheme } from "@/lib/digital-cards/themes";

/**
 * Padrão do Cartão Digital ESCOLHIDO PELO DONO — camada acima do padrão "de
 * fábrica" hardcoded (ver lib/digital-cards/config.ts). Lido a cada cartão
 * renderizado (lib/digital-cards/queries.ts, enrichCard) e escrito só pela
 * rota OWNER-only app/api/digital-cards/org-defaults/[field]/route.ts —
 * pedido explícito: "eu posso adicionar com um botão (apenas o dono) de
 * 'manter padrão para todos', aí a imagem que eu escolher vira padrão".
 *
 * Guardado em Organization.digitalCardDefaults (Json?, ver schema) com as
 * MESMAS chaves R2 de DigitalCard.photoKey/coverPhotoKey/backgroundPhotoKey
 * — resolvidas do mesmo jeito (resolveAvatarUrl), nunca uma URL pronta
 * (uma assinatura de URL expira em ~1h; guardar só a CHAVE deixa a
 * resolução sempre em cima da hora, igual ao cartão de cada pessoa).
 *
 * A chave `theme` ("DARK" | "LIGHT" | "PHOTO") segue a MESMA lógica de
 * "padrão do dono", só que guardando um enum em vez de uma chave R2 —
 * pedido: "se eu (login de dono) deixar como padrão vai para todos os
 * consultores". Vale pra todo cartão cujo DigitalCard.theme é null; quem já
 * escolheu um tema próprio nunca é sobrescrito (ver resolveCardTheme).
 */
export type DigitalCardDefaultsField = "photo" | "cover" | "background" | "theme";

export type OrgCardDefaults = {
  photoKey?: string | null;
  coverPhotoKey?: string | null;
  backgroundPhotoKey?: string | null;
  /** Chave ausente/null = organização nunca definiu tema padrão → todo mundo sem tema próprio cai no DARK de fábrica. */
  theme?: CardTheme | null;
};

const FIELD_TO_KEY = {
  photo: "photoKey",
  cover: "coverPhotoKey",
  background: "backgroundPhotoKey",
} as const satisfies Record<Exclude<DigitalCardDefaultsField, "theme">, keyof OrgCardDefaults>;

/** Objeto vazio quando a organização nunca configurou nada — nunca lança, chamado a cada render de cartão. */
export async function getOrgCardDefaults(organizationId: string): Promise<OrgCardDefaults> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { digitalCardDefaults: true } });
  return (org?.digitalCardDefaults as OrgCardDefaults | null) ?? {};
}

export async function setOrgCardDefault(organizationId: string, field: Exclude<DigitalCardDefaultsField, "theme">, key: string): Promise<void> {
  const current = await getOrgCardDefaults(organizationId);
  const next: OrgCardDefaults = { ...current, [FIELD_TO_KEY[field]]: key };
  await prisma.organization.update({ where: { id: organizationId }, data: { digitalCardDefaults: next } });
}

/** Volta a cair no padrão de fábrica (ou gradiente/ícone genérico, se nem esse existir) pro campo — nunca mexe nos outros campos. */
export async function clearOrgCardDefault(organizationId: string, field: Exclude<DigitalCardDefaultsField, "theme">): Promise<void> {
  const current = await getOrgCardDefaults(organizationId);
  const next: OrgCardDefaults = { ...current };
  delete next[FIELD_TO_KEY[field]];
  await prisma.organization.update({ where: { id: organizationId }, data: { digitalCardDefaults: next } });
}

/**
 * TEMA padrão da equipe ("Manter este tema padrão para todos", OWNER-only,
 * ver card-editor.tsx) — não mexe em DigitalCardTheme nenhum, só define qual
 * tema vale pra quem ainda nunca escolheu (DigitalCard.theme null).
 */
export async function setOrgCardTheme(organizationId: string, theme: CardTheme): Promise<void> {
  const current = await getOrgCardDefaults(organizationId);
  await prisma.organization.update({ where: { id: organizationId }, data: { digitalCardDefaults: { ...current, theme } } });
}

/** Deixa de haver tema padrão da equipe — volta ao DARK de fábrica pra quem nunca escolheu; não muda o tema de quem já escolheu. */
export async function clearOrgCardTheme(organizationId: string): Promise<void> {
  const current = await getOrgCardDefaults(organizationId);
  const next: OrgCardDefaults = { ...current };
  delete next.theme;
  await prisma.organization.update({ where: { id: organizationId }, data: { digitalCardDefaults: next } });
}

/** Normaliza o que veio do Json — um valor estranho virara null (sem tema padrão) em vez de vazar pro resto do sistema. */
export function normalizeOrgCardTheme(defaults: OrgCardDefaults): CardTheme | null {
  return isCardTheme(defaults.theme) ? defaults.theme : null;
}

