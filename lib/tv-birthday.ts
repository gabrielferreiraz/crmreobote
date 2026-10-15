/**
 * Slide "Feliz aniversário" da TV — configuração guardada em
 * TvDashboardConfig.birthdaySlide (JSON). Módulo puro, sem prisma: lido pelo
 * servidor (lib/tv-dashboard.ts, configuracoes/tv/actions.ts) e só os tipos
 * pela tela de configuração.
 */
export type TvBirthdaySlideConfig = {
  /** Fundo padrão, igual pra todo mundo. */
  backgroundUrl: string | null;
  /** userId → foto do consultor JÁ recortada (PNG sem fundo). */
  photos: Record<string, string>;
};

/** JSON do banco (ou lixo) → config sempre bem formada. */
export function parseTvBirthdaySlide(raw: unknown): TvBirthdaySlideConfig {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const photosRaw = obj.photos && typeof obj.photos === "object" && !Array.isArray(obj.photos) ? (obj.photos as Record<string, unknown>) : {};
  const photos: Record<string, string> = {};
  for (const [userId, url] of Object.entries(photosRaw)) {
    if (typeof url === "string" && url) photos[userId] = url;
  }
  return {
    backgroundUrl: typeof obj.backgroundUrl === "string" && obj.backgroundUrl ? obj.backgroundUrl : null,
    photos,
  };
}
