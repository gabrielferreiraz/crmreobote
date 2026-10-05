import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { runWithTenant } from "@/lib/tenant-context";
import { getOrCreateOwnCard, getCardStats, getOwnCard } from "@/lib/digital-cards/queries";
import { syncOrgCardMediaDefaults, type OrgCardDefaults } from "@/lib/digital-cards/org-defaults";
import { publicCardUrlFromHeaders } from "@/lib/digital-cards/public-url";
import { CardEditor } from "./card-editor";
import { QrCodePanel } from "./qr-code-panel";
import { CardStats } from "./card-stats";

export const dynamic = "force-dynamic";

/**
 * "Meu Cartão" — área pessoal (mesmo grupo de /configuracoes/perfil, ver
 * seção "Conta" em configuracoes/page.tsx), sempre dentro de (dashboard),
 * autenticada via auth() normal (nunca requireDigitalCard — essa é só pra
 * página pública). Cria o cartão automaticamente na primeira visita
 * (inativo, ver getOrCreateOwnCard) — a pessoa nunca precisa de um passo
 * separado de "criar cartão" antes de poder configurá-lo.
 *
 * Só a EDIÇÃO mora aqui — o cartão em si é a página pública
 * (app/c/[slug]/page.tsx), acessada pelo atalho "Cartão de visita" do menu
 * do usuário (ver components/user-menu.tsx).
 */
export default async function MeuCartaoPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const userId = session!.user.id;
  const isOwner = session!.user.role === "OWNER";
  const hdrs = await headers();

  const { card, stats, publicUrl, orgDefaultsSet } = await runWithTenant(organizationId, async () => {
    let card = await getOrCreateOwnCard(organizationId, userId);
    let orgDefaults: OrgCardDefaults | null = null;
    if (isOwner) {
      const synced = await syncOrgCardMediaDefaults(organizationId, {
        coverPhotoKey: card.coverPhotoKey,
        backgroundPhotoKey: card.backgroundPhotoKey,
      });
      orgDefaults = synced.defaults;

      // Se um padrão antigo estava quebrado ou ausente, recarrega as URLs
      // assinadas já usando a configuração reconciliada neste mesmo acesso.
      if (synced.changed) card = (await getOwnCard(userId)) ?? card;
    }
    const stats = await getCardStats(card.id);
    return {
      card,
      stats,
      publicUrl: publicCardUrlFromHeaders(card.slug, hdrs),
      orgDefaultsSet: {
        theme: orgDefaults?.theme ?? null,
      },
    };
  });

  return (
    // max-w-5xl: formulário + prévia lado a lado no computador (ver card-editor.tsx).
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Meu cartão</h1>
        <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">Monte, veja como fica e compartilhe.</p>
      </div>

      <CardEditor
        card={card}
        publicUrl={publicUrl}
        isOwner={isOwner}
        orgDefaultsSet={orgDefaultsSet}
        // O QR só existe com o cartão no ar — vira o primeiro botão do bloco
        // "Cartão no ar", junto de Copiar/Enviar/Abrir (antes ficava no fim
        // da página, depois de todo o formulário).
        qrButton={card.active ? <QrCodePanel cardId={card.id} publicUrl={publicUrl} /> : undefined}
      />

      {card.active && <CardStats stats={stats} />}
    </div>
  );
}
