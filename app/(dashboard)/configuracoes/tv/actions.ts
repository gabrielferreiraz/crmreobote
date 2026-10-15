"use server";

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { isAllowedTvAdUrl, deleteTvAdByUrl } from "@/lib/r2";
import { parseTvBirthdaySlide } from "@/lib/tv-birthday";

const MAX_ADS = 30;
const MAX_WIDGETS = 50;

export async function saveTvConfig({
  adsUrls,
  selectedStageIds,
  visibleWidgets,
}: {
  adsUrls: string[];
  selectedStageIds: string[];
  visibleWidgets: string[];
}) {
  try {
    // Só Dono/Gerente (mesmo nível que já gera o link público da TV): a TV
    // principal fica à vista de cliente — antes QUALQUER papel, inclusive
    // Consultor, podia trocar o que ela mostra (auditoria 09/2026).
    const access = await requireRole(["OWNER", "MANAGER"]);
    if (!access.ok) return { success: false, error: "Só o dono ou um gerente pode alterar a TV." };
    const { organizationId } = access;

    // Server Action recebe o que o cliente mandar — valida formato e origem.
    // Anúncio só pode ser imagem hospedada no nosso bucket de anúncios DESTA
    // organização (é o que o upload gera); link externo colado virava imagem
    // de terceiro exibida pro cliente.
    if (!Array.isArray(adsUrls) || !Array.isArray(selectedStageIds) || !Array.isArray(visibleWidgets)) {
      return { success: false, error: "Dados inválidos." };
    }
    if (adsUrls.length > MAX_ADS || visibleWidgets.length > MAX_WIDGETS) {
      return { success: false, error: "Itens demais na configuração." };
    }
    if (visibleWidgets.some((w) => typeof w !== "string" || w.length > 60)) {
      return { success: false, error: "Dados inválidos." };
    }

    // TvDashboardConfig tem RLS (ver migração
    // 20260812090000_tv_dashboard_config_rls) — sem este wrap, a policy
    // nunca via app.current_organization_id definido e o upsert falhava
    // em silêncio. Mesma 2ª camada de proteção que o resto do app usa, não
    // só o `where`/`create` acima.
    const result = await runWithTenant(organizationId, async () => {
      // URL que JÁ estava salva continua valendo (anúncio antigo colado à mão
      // antes do upload existir) — só URL nova precisa ser do nosso bucket.
      const current = await prisma.tvDashboardConfig.findUnique({ where: { organizationId }, select: { adsUrls: true } });
      const savedList = Array.isArray(current?.adsUrls) ? (current.adsUrls as unknown[]) : [];
      const alreadySaved = new Set(savedList.filter((u): u is string => typeof u === "string"));
      if (adsUrls.some((url) => typeof url !== "string" || (!alreadySaved.has(url) && !isAllowedTvAdUrl(url, organizationId)))) {
        return { success: false as const, error: "Anúncio inválido — envie a imagem pelo botão de upload." };
      }

      // Etapa só desta organização (PipelineStage tem RLS por join com Pipeline).
      const validStages = selectedStageIds.length
        ? await prisma.pipelineStage.findMany({
            where: { id: { in: selectedStageIds.filter((id) => typeof id === "string") }, pipeline: { organizationId } },
            select: { id: true },
          })
        : [];
      const stageIds = validStages.map((s) => s.id);

      await prisma.tvDashboardConfig.upsert({
        where: { organizationId },
        update: { adsUrls, selectedStageIds: stageIds, visibleWidgets },
        create: { organizationId, adsUrls, selectedStageIds: stageIds, visibleWidgets },
      });
      return { success: true as const };
    });

    return result;
  } catch (error) {
    console.error("[saveTvConfig] Error:", error);
    return { success: false, error: "Falha ao salvar as configurações." };
  }
}

/**
 * Slide "Feliz aniversário" da TV (ver lib/tv-birthday.ts) — salva NA HORA,
 * a cada envio/remoção (igual as fotos do Cartão Digital), sem depender do
 * "Salvar Configurações" do formulário de cima.
 *
 * `photo`: userId = foto daquele consultor; sem userId = o fundo padrão.
 * `url` null = remover. A imagem antiga é apagada do bucket depois de salvar.
 */
export async function saveTvBirthdayImage({ userId, url }: { userId?: string; url: string | null }) {
  try {
    const access = await requireRole(["OWNER", "MANAGER"]);
    if (!access.ok) return { success: false as const, error: "Só o dono ou um gerente pode alterar a TV." };
    const { organizationId } = access;

    if (url !== null && (typeof url !== "string" || !isAllowedTvAdUrl(url, organizationId))) {
      return { success: false as const, error: "Imagem inválida — envie pelo botão de upload." };
    }
    if (userId !== undefined && typeof userId !== "string") return { success: false as const, error: "Dados inválidos." };

    return await runWithTenant(organizationId, async () => {
      if (userId) {
        const member = await prisma.organizationUser.findFirst({ where: { organizationId, userId }, select: { id: true } });
        if (!member) return { success: false as const, error: "Usuário não encontrado." };
      }

      const current = await prisma.tvDashboardConfig.findUnique({ where: { organizationId }, select: { birthdaySlide: true } });
      const slide = parseTvBirthdaySlide(current?.birthdaySlide);
      const previousUrl = userId ? (slide.photos[userId] ?? null) : slide.backgroundUrl;

      if (userId) {
        if (url) slide.photos[userId] = url;
        else delete slide.photos[userId];
      } else {
        slide.backgroundUrl = url;
      }

      await prisma.tvDashboardConfig.upsert({
        where: { organizationId },
        update: { birthdaySlide: slide },
        create: { organizationId, birthdaySlide: slide },
      });

      if (previousUrl && previousUrl !== url) await deleteTvAdByUrl(previousUrl, organizationId).catch(() => {});
      return { success: true as const };
    });
  } catch (error) {
    console.error("[saveTvBirthdayImage] Error:", error);
    return { success: false as const, error: "Falha ao salvar a imagem." };
  }
}
