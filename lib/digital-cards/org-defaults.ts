import { prisma } from "@/lib/prisma";

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
 */
export type DigitalCardDefaultsField = "photo" | "cover" | "background";

export type OrgCardDefaults = {
  photoKey?: string | null;
  coverPhotoKey?: string | null;
  backgroundPhotoKey?: string | null;
};

const FIELD_TO_KEY = {
  photo: "photoKey",
  cover: "coverPhotoKey",
  background: "backgroundPhotoKey",
} as const satisfies Record<DigitalCardDefaultsField, keyof OrgCardDefaults>;

/** Objeto vazio quando a organização nunca configurou nada — nunca lança, chamado a cada render de cartão. */
export async function getOrgCardDefaults(organizationId: string): Promise<OrgCardDefaults> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { digitalCardDefaults: true } });
  return (org?.digitalCardDefaults as OrgCardDefaults | null) ?? {};
}

export async function setOrgCardDefault(organizationId: string, field: DigitalCardDefaultsField, key: string): Promise<void> {
  const current = await getOrgCardDefaults(organizationId);
  const next: OrgCardDefaults = { ...current, [FIELD_TO_KEY[field]]: key };
  await prisma.organization.update({ where: { id: organizationId }, data: { digitalCardDefaults: next } });
}

/** Volta a cair no padrão de fábrica (ou gradiente/ícone genérico, se nem esse existir) pro campo — nunca mexe nos outros dois campos. */
export async function clearOrgCardDefault(organizationId: string, field: DigitalCardDefaultsField): Promise<void> {
  const current = await getOrgCardDefaults(organizationId);
  const next: OrgCardDefaults = { ...current };
  delete next[FIELD_TO_KEY[field]];
  await prisma.organization.update({ where: { id: organizationId }, data: { digitalCardDefaults: next } });
}
