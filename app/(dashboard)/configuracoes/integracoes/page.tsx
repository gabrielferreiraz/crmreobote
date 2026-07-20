import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ApiKeysManager } from "./api-keys-manager";
import { WebhooksManager } from "./webhooks-manager";
import { MetaAdsConnect } from "@/components/meta-ads-connect";

export default async function IntegracoesSettingsPage() {
  const session = await auth();
  if (!session?.user.role || !["OWNER", "MANAGER"].includes(session.user.role)) {
    redirect("/configuracoes");
  }

  const organizationId = session.user.organizationId!;

  return runWithTenant(organizationId, async () => {
    const [apiKeysRaw, webhooksRaw] = await Promise.all([
      prisma.apiKey.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        include: { createdBy: { select: { name: true } } },
      }),
      prisma.webhookSubscription.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        include: { createdBy: { select: { name: true } } },
      }),
    ]);

    const apiKeys = apiKeysRaw.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      createdByName: k.createdBy.name,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      revokedAt: k.revokedAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
    }));

    const webhooks = webhooksRaw.map((w) => ({
      id: w.id,
      url: w.url,
      events: w.events,
      active: w.active,
      createdByName: w.createdBy.name,
      createdAt: w.createdAt.toISOString(),
    }));

    return (
      <div className="max-w-3xl space-y-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Integrações</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Conecte geradores de leads, listas frias, outros CRMs ou automações (Make/Zapier) — ver a{" "}
            <Link
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-neutral-700 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900 dark:text-neutral-300 dark:decoration-neutral-600 dark:hover:text-neutral-100"
            >
              documentação da API
            </Link>{" "}
            pra exemplos completos de payload.
          </p>
        </div>

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Chaves de API</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Autenticação de entrada — quem tiver a chave pode criar/atualizar contatos e negócios via{" "}
              <code className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800">/api/v1</code>.
            </p>
          </div>
          <ApiKeysManager initialKeys={apiKeys} />
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Webhooks</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Notificação de saída — o CRM avisa a URL configurada quando um negócio é ganho/perdido ou um contato é criado.
            </p>
          </div>
          <WebhooksManager initialWebhooks={webhooks} />
        </section>

        <section className="space-y-3 border-t border-neutral-100 pt-6 dark:border-neutral-800">
          <div>
            <h2 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Meta Ads</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Lead recebido pelo formulário nativo do Facebook/Instagram já cai como Contato (e um Negócio na pipeline
              padrão) automaticamente, marcado com qual campanha/anúncio gerou ele.
            </p>
          </div>
          <Suspense fallback={<p className="text-sm text-neutral-400 dark:text-neutral-500">Verificando…</p>}>
            <MetaAdsConnect />
          </Suspense>
        </section>
      </div>
    );
  });
}
