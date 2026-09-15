import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { runWithTenant } from "@/lib/tenant-context";
import { getOrCreateOwnCard, getCardStats } from "@/lib/digital-cards/queries";
import { publicCardUrlFromHeaders } from "@/lib/digital-cards/public-url";
import { CardEditor } from "./card-editor";
import { QrCodePanel } from "./qr-code-panel";
import { CardStats } from "./card-stats";
import { CardQuickView } from "./card-quick-view";

export const dynamic = "force-dynamic";

/**
 * "Meu Cartão" — área pessoal (mesmo grupo de /configuracoes/perfil, ver
 * seção "Conta" em configuracoes/page.tsx), sempre dentro de (dashboard),
 * autenticada via auth() normal (nunca requireDigitalCard — essa é só pra
 * página pública). Cria o cartão automaticamente na primeira visita
 * (inativo, ver getOrCreateOwnCard) — a pessoa nunca precisa de um passo
 * separado de "criar cartão" antes de poder configurá-lo.
 *
 * `?mostrar=1` — atalho "Cartão de visita" no menu do usuário (ver
 * components/user-menu.tsx): pula direto pro modo de apresentar (ver
 * card-quick-view.tsx), sem o formulário de edição. Editar continua só
 * chegando por aqui sem o parâmetro (pedido explícito: "a configuração
 * deve ainda manter e lá dentro de configurações aí sim editar").
 */
export default async function MeuCartaoPage({ searchParams }: { searchParams: Promise<{ mostrar?: string }> }) {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const userId = session!.user.id;
  const hdrs = await headers();
  const { mostrar } = await searchParams;

  const { card, stats, publicUrl } = await runWithTenant(organizationId, async () => {
    const card = await getOrCreateOwnCard(organizationId, userId);
    const stats = await getCardStats(card.id);
    return { card, stats, publicUrl: publicCardUrlFromHeaders(card.slug, hdrs) };
  });

  if (mostrar === "1") {
    return <CardQuickView card={card} stats={stats} publicUrl={publicUrl} />;
  }

  return (
    // max-w-5xl (não max-w-2xl como o resto de Configurações) de propósito:
    // esta página tem formulário + pré-visualização lado a lado (ver
    // card-editor.tsx) — dentro de max-w-2xl a coluna do formulário ficava
    // espremida a ~330px, cortando até o placeholder dos campos no meio da
    // palavra.
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Cartão Digital</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Seu cartão de visita digital — apresente por QR Code ou compartilhe o link.
        </p>
      </div>

      <CardEditor card={card} publicUrl={publicUrl} />

      {card.active && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="card p-4">
            <QrCodePanel cardId={card.id} publicUrl={publicUrl} />
          </div>
          <div className="card p-4">
            <CardStats stats={stats} />
          </div>
        </div>
      )}
    </div>
  );
}
