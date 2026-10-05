import { prisma } from "@/lib/prisma";
import { isCardTheme, type CardTheme } from "@/lib/digital-cards/themes";

/**
 * Padrão do Cartão Digital ESCOLHIDO PELO DONO — camada acima do padrão "de
 * fábrica" hardcoded (ver lib/digital-cards/config.ts). Lido a cada cartão
 * renderizado (lib/digital-cards/queries.ts, enrichCard). Capa e fundo do
 * cartão do OWNER são sincronizados automaticamente pelas rotas de upload;
 * o tema continua sendo uma escolha explícita.
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
 * Preenche somente padrões ainda ausentes usando as imagens do dono que
 * abriu o editor ou, se ele não tiver, de outro OWNER com imagem própria.
 * Nunca apaga nem substitui um padrão já definido: isso é responsabilidade
 * exclusiva das rotas de upload/remoção.
 *
 * Essa distinção é importante em organizações com mais de um OWNER. Um dono
 * sem capa própria não pode apagar a capa institucional ao abrir a página.
 */
export async function initializeMissingOrgCardMediaDefaults(
  organizationId: string,
  media: { coverPhotoKey: string | null; backgroundPhotoKey: string | null },
): Promise<{ defaults: OrgCardDefaults; changed: boolean }> {
  const current = await getOrgCardDefaults(organizationId);
  const next: OrgCardDefaults = { ...current };

  if (!current.coverPhotoKey && media.coverPhotoKey) next.coverPhotoKey = media.coverPhotoKey;
  if (!current.backgroundPhotoKey && media.backgroundPhotoKey) next.backgroundPhotoKey = media.backgroundPhotoKey;

  // Se este dono não tem imagem própria, recupera o padrão a partir de
  // outro cartão de OWNER. Isso repara automaticamente organizações cujo
  // padrão foi apagado pelo comportamento antigo, sem depender de abrir
  // primeiro a conta específica que fez o upload.
  const needsCoverRecovery = !next.coverPhotoKey;
  const needsBackgroundRecovery = !next.backgroundPhotoKey;
  if (needsCoverRecovery || needsBackgroundRecovery) {
    const owners = await prisma.organizationUser.findMany({
      where: { organizationId, role: "OWNER", active: true },
      select: { userId: true },
    });
    const ownerIds = owners.map((owner) => owner.userId);

    if (ownerIds.length > 0) {
      const [coverCard, backgroundCard] = await Promise.all([
        needsCoverRecovery
          ? prisma.digitalCard.findFirst({
              where: { organizationId, userId: { in: ownerIds }, coverPhotoKey: { not: null } },
              orderBy: { updatedAt: "desc" },
              select: { coverPhotoKey: true },
            })
          : null,
        needsBackgroundRecovery
          ? prisma.digitalCard.findFirst({
              where: { organizationId, userId: { in: ownerIds }, backgroundPhotoKey: { not: null } },
              orderBy: { updatedAt: "desc" },
              select: { backgroundPhotoKey: true },
            })
          : null,
      ]);

      if (coverCard?.coverPhotoKey) next.coverPhotoKey = coverCard.coverPhotoKey;
      if (backgroundCard?.backgroundPhotoKey) next.backgroundPhotoKey = backgroundCard.backgroundPhotoKey;
    }
  }

  const changed =
    current.coverPhotoKey !== next.coverPhotoKey ||
    current.backgroundPhotoKey !== next.backgroundPhotoKey;

  if (changed) {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { digitalCardDefaults: next },
    });
  }

  return { defaults: next, changed };
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
