import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { resolveAvatarUrl } from "@/lib/r2";
import { resolveConnectedInstance } from "@/lib/whatsapp/send";
import { slugify, ensureUniqueSlug } from "@/lib/digital-cards/slug";
import { DEFAULT_COVER_PHOTO_URL, DEFAULT_BACKGROUND_PHOTO_URL, DEFAULT_AVATAR_URL } from "@/lib/digital-cards/config";
import { getOrgCardDefaults, normalizeOrgCardTheme } from "@/lib/digital-cards/org-defaults";
import { resolveCardTheme, type CardTheme } from "@/lib/digital-cards/themes";
// Reexportado por compatibilidade com quem já importava daqui — mas
// componente "use client" deve importar de @/lib/phone-normalize
// diretamente (ver comentário lá: importar deste arquivo no cliente arrasta
// prisma/sharp/pg pro bundle do navegador e quebra o build).
export { displayPhone } from "@/lib/phone-normalize";

/**
 * Card "enriquecido" pra exibição — resolve nome/e-mail/foto do User
 * (fonte de verdade), aplicando overrides de apresentação do cartão quando
 * eles existirem.
 * Usado tanto pela página pública quanto pelo preview em "Meu Cartão" (ver
 * decisão no plano: nome/e-mail/foto nunca são copiados pro cartão; nome e
 * e-mail podem ter apenas um override opcional de apresentação).
 */
export type DigitalCardWithUser = Awaited<ReturnType<typeof getCardDetails>>;

const CARD_INCLUDE = {
  user: { select: { id: true, name: true, email: true, image: true } },
  links: { where: { active: true }, orderBy: { order: "asc" as const } },
} satisfies Parameters<typeof prisma.digitalCard.findUnique>[0]["include"];

async function enrichCard<
  T extends {
    organizationId: string;
    photoKey: string | null;
    coverPhotoKey: string | null;
    backgroundPhotoKey: string | null;
    displayNameOverride: string | null;
    emailOverride: string | null;
    theme: CardTheme | null;
    user: { name: string; email: string; image: string | null };
  },
>(card: T) {
  const coverPhotoKeys = card.coverPhotoKey ? card.coverPhotoKey.split(",").filter(Boolean) : [];
  const [ownPhotoUrl, ownCoverUrls, ownBackgroundUrl, orgDefaults] = await Promise.all([
    resolveAvatarUrl(card.photoKey ?? card.user.image),
    Promise.all(coverPhotoKeys.map((k) => resolveAvatarUrl(k))),
    resolveAvatarUrl(card.backgroundPhotoKey),
    getOrgCardDefaults(card.organizationId),
  ]);
  const validOwnCoverUrls = ownCoverUrls.filter((u): u is string => !!u);
  const ownCoverUrl = validOwnCoverUrls[0] ?? null;

  const [orgPhotoUrl, orgCoverUrl, orgBackgroundUrl] = await Promise.all([
    resolveAvatarUrl(orgDefaults.photoKey ?? null),
    resolveAvatarUrl(orgDefaults.coverPhotoKey ?? null),
    resolveAvatarUrl(orgDefaults.backgroundPhotoKey ?? null),
  ]);
  // Ordem de fallback SEMPRE: override do próprio cartão → foto real do
  // perfil (só pro avatar, ver photoUrl) → padrão ESCOLHIDO PELO DONO (ver
  // lib/digital-cards/org-defaults.ts, "Manter padrão para todos" em Meu
  // Cartão) → padrão "de fábrica" hardcoded (lib/digital-cards/config.ts —
  // null enquanto nada foi configurado, nesse caso o componente visual usa
  // gradiente/ícone genérico) — pedido explícito: "todos podem remover e
  // colocar uma nova foto, mas pode voltar ao padrão" — remover a própria
  // SEMPRE cai num dos padrões, nunca pula direto pro fallback final.
  const photoUrl = ownPhotoUrl ?? orgPhotoUrl ?? DEFAULT_AVATAR_URL;
  const coverPhotoUrl = ownCoverUrl ?? orgCoverUrl ?? DEFAULT_COVER_PHOTO_URL;
  const coverPhotoUrls = validOwnCoverUrls.length > 0
    ? validOwnCoverUrls
    : (coverPhotoUrl ? [coverPhotoUrl] : []);
  const backgroundPhotoUrl = ownBackgroundUrl ?? orgBackgroundUrl ?? DEFAULT_BACKGROUND_PHOTO_URL;
  const orgDefaultTheme = normalizeOrgCardTheme(orgDefaults);
  const effectiveTheme = resolveCardTheme(card.theme, orgDefaultTheme);
  return {
    ...card,
    displayName: card.displayNameOverride || card.user.name,
    displayEmail: card.emailOverride || card.user.email,
    photoUrl,
    coverPhotoUrl,
    coverPhotoUrls,
    backgroundPhotoUrl,
    effectiveTheme,
    orgDefaultTheme,
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
 * Versão MÍNIMA de getOwnCard — só slug+active, sem include de user/links
 * nem resolução de URL assinada de foto nenhuma. Usada em
 * app/(dashboard)/layout.tsx (o menu "Cartão de visita" precisa saber pra
 * onde linkar), que roda em TODA navegação do CRM — buscar o cartão
 * completo ali seria trabalho à toa (2 URLs assinadas + join de links) só
 * pra decidir um href.
 */
export async function getOwnCardShortcut(userId: string): Promise<{ slug: string; active: boolean } | null> {
  return prisma.digitalCard.findUnique({ where: { userId }, select: { slug: true, active: true } });
}

/**
 * Primeira visita a "Meu Cartão" ainda sem cartão nenhum — cria já ATIVO
 * (pedido explícito: "o cartão já deve vir ativo" — o consultor não precisa
 * lembrar de um passo extra pra publicar antes de poder compartilhar o
 * link), com slug sugerido a partir do nome e WhatsApp pré-preenchido a
 * partir da WhatsAppInstance conectada do usuário (ver
 * resolveConnectedInstance, lib/whatsapp/send.ts) — vira um campo PRÓPRIO e
 * editável do cartão a partir daqui, nunca mais sincronizado automaticamente
 * com a instância (ver comentário no schema). `active` continua editável
 * (pode desativar) — só o valor de nascença que mudou.
 */
export async function getOrCreateOwnCard(organizationId: string, userId: string) {
  const existing = await getOwnCard(userId);
  if (existing) return existing;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  const [slug, instance] = await Promise.all([
    ensureUniqueSlug(slugify(user.name)),
    resolveConnectedInstance(organizationId, userId),
  ]);

  try {
    const created = await prisma.digitalCard.create({
      data: {
        organizationId,
        userId,
        slug,
        active: true,
        whatsapp: instance?.phoneNumber ?? null,
        address: "Av. Toros Puxian, 1019 - Vila Morumbi, Campo Grande - MS, 79052-030",
        companyName: null,
        jobTitle: "Consultor de Vendas",
        bio: "Inteligência em Consórcios",
      },
      include: CARD_INCLUDE,
    });
    return enrichCard(created);
  } catch (err) {
    // Corrida: duas abas abrindo "Meu Cartão" pela primeira vez ao mesmo
    // tempo podem ambas ver `existing === null` acima e tentar criar — a
    // constraint única em userId garante que só uma vence, a outra cai
    // aqui. Em vez de estourar um 500 genérico, busca a linha que a
    // primeira acabou de criar (ela já existe garantidamente nesse ponto).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await getOwnCard(userId);
      if (winner) return winner;
    }
    throw err;
  }
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
