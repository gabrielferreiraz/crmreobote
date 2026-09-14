import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/r2";
import { resolveConnectedInstance } from "@/lib/whatsapp/send";
import { slugify, ensureUniqueSlug } from "@/lib/digital-cards/slug";
import { DEFAULT_COVER_PHOTO_URL } from "@/lib/digital-cards/config";
// Reexportado por compatibilidade com quem já importava daqui — mas
// componente "use client" deve importar de @/lib/phone-normalize
// diretamente (ver comentário lá: importar deste arquivo no cliente arrasta
// prisma/sharp/pg pro bundle do navegador e quebra o build).
export { displayPhone } from "@/lib/phone-normalize";

/**
 * Card "enriquecido" pra exibição — resolve nome/e-mail/foto do User
 * (fonte de verdade), aplicando override do cartão só quando ele existir.
 * Usado tanto pela página pública quanto pelo preview em "Meu Cartão" (ver
 * decisão no plano: nome/e-mail/foto NUNCA são copiados pro cartão, sempre
 * lidos do User em tempo de render).
 */
export type DigitalCardWithUser = Awaited<ReturnType<typeof getCardDetails>>;

const CARD_INCLUDE = {
  user: { select: { id: true, name: true, email: true, image: true } },
  links: { where: { active: true }, orderBy: { order: "asc" as const } },
} satisfies Parameters<typeof prisma.digitalCard.findUnique>[0]["include"];

async function enrichCard<
  T extends {
    photoKey: string | null;
    coverPhotoKey: string | null;
    emailOverride: string | null;
    user: { name: string; email: string; image: string | null };
  },
>(card: T) {
  const [photoUrl, ownCoverUrl] = await Promise.all([
    resolveAvatarUrl(card.photoKey ?? card.user.image),
    resolveAvatarUrl(card.coverPhotoKey),
  ]);
  // Sem capa própria, cai pro padrão da organização (DEFAULT_COVER_PHOTO_URL,
  // ver lib/digital-cards/config.ts — null enquanto nenhuma foto real
  // chegou; nesse caso o componente visual usa o gradiente abstrato) antes
  // de cair pro gradiente — nunca pula direto pro gradiente se existir um
  // padrão configurado.
  const coverPhotoUrl = ownCoverUrl ?? DEFAULT_COVER_PHOTO_URL;
  return {
    ...card,
    displayName: card.user.name,
    displayEmail: card.emailOverride || card.user.email,
    photoUrl,
    coverPhotoUrl,
  };
}

/**
 * SÓ pra dentro do bootstrap de slug (runWithCardSlugLookup, ver
 * lib/require-digital-card.ts) — busca linha MÍNIMA (sem include nenhum),
 * de propósito: `links`/`user` são tabelas com RLS própria org-scoped
 * normal (`organizationId = current_setting(...)`), que ainda não está
 * definido nesse ponto (só `app.current_card_slug` está) — um include aqui
 * voltaria vazio em silêncio por causa da RLS das tabelas relacionadas, não
 * porque o dado não existe. Devolve só organizationId/id; quem chama troca
 * pra runWithTenant(organizationId, ...) e busca o resto com
 * getCardDetails abaixo.
 */
export async function getCardRowBySlug(slug: string) {
  return prisma.digitalCard.findUnique({ where: { slug } });
}

/** Já dentro de runWithTenant(organizationId, ...) — usada tanto pela página pública (depois do bootstrap resolver o org) quanto por "Meu Cartão" (org já vem da sessão). */
export async function getCardDetails(cardId: string) {
  const card = await prisma.digitalCard.findUnique({ where: { id: cardId }, include: CARD_INCLUDE });
  if (!card) return null;
  return enrichCard(card);
}

/** Autenticado — "Meu Cartão" (ver app/(dashboard)/configuracoes/meu-cartao/page.tsx). */
export async function getOwnCard(userId: string) {
  const card = await prisma.digitalCard.findUnique({ where: { userId }, include: CARD_INCLUDE });
  if (!card) return null;
  return enrichCard(card);
}

/**
 * Primeira visita a "Meu Cartão" ainda sem cartão nenhum — cria um NASCENDO
 * INATIVO (nunca fica público sozinho só por existir a linha), com slug
 * sugerido a partir do nome e WhatsApp pré-preenchido a partir da
 * WhatsAppInstance conectada do usuário (ver resolveConnectedInstance,
 * lib/whatsapp/send.ts) — vira um campo PRÓPRIO e editável do cartão a
 * partir daqui, nunca mais sincronizado automaticamente com a instância
 * (ver comentário no schema).
 */
export async function getOrCreateOwnCard(organizationId: string, userId: string) {
  const existing = await getOwnCard(userId);
  if (existing) return existing;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  const [slug, instance] = await Promise.all([
    ensureUniqueSlug(slugify(user.name)),
    resolveConnectedInstance(organizationId, userId),
  ]);

  const created = await prisma.digitalCard.create({
    data: { organizationId, userId, slug, whatsapp: instance?.phoneNumber ?? null },
    include: CARD_INCLUDE,
  });
  return enrichCard(created);
}

export type CardStats = {
  views: number;
  uniqueVisitorsEstimate: number;
  whatsappClicks: number;
  phoneClicks: number;
  vcardDownloads: number;
  shares: number;
  lastAccessAt: Date | null;
};

/** Contagens simples por eventType + visitantes únicos estimados (sessionId distinto em CARD_VIEW) — dashboard básico de "Meu Cartão". */
export async function getCardStats(cardId: string): Promise<CardStats> {
  const [views, whatsappClicks, phoneClicks, vcardDownloads, shares, lastView, distinctSessions] = await Promise.all([
    prisma.digitalCardEvent.count({ where: { cardId, eventType: "CARD_VIEW" } }),
    prisma.digitalCardEvent.count({ where: { cardId, eventType: "WHATSAPP_CLICK" } }),
    prisma.digitalCardEvent.count({ where: { cardId, eventType: "PHONE_CLICK" } }),
    prisma.digitalCardEvent.count({ where: { cardId, eventType: "VCARD_DOWNLOAD" } }),
    prisma.digitalCardEvent.count({ where: { cardId, eventType: "SHARE_CLICK" } }),
    prisma.digitalCardEvent.findFirst({ where: { cardId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.digitalCardEvent.findMany({
      where: { cardId, eventType: "CARD_VIEW", sessionId: { not: null } },
      distinct: ["sessionId"],
      select: { sessionId: true },
    }),
  ]);

  return {
    views,
    uniqueVisitorsEstimate: distinctSessions.length,
    whatsappClicks,
    phoneClicks,
    vcardDownloads,
    shares,
    lastAccessAt: lastView?.createdAt ?? null,
  };
}

