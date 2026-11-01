import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getLista50Config, lista50IsLive } from "@/lib/lista-50";
import { Lista50AdminToggle } from "@/app/(dashboard)/lista-50/lista-50-admin-toggle";

export default async function Lista50SettingsPage() {
  const session = await auth();
  if (session?.user.role !== "OWNER") {
    redirect("/configuracoes");
  }
  const organizationId = session.user.organizationId!;

  return runWithTenant(organizationId, async () => {
    const [config, totalDelivered] = await Promise.all([
      getLista50Config(organizationId),
      prisma.deal.count({ where: { organizationId, lista50: true } }),
    ]);
    const live = lista50IsLive(config);

    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/50">
          <p className="text-xs font-semibold tracking-wide text-brand uppercase">Campanha sazonal</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Lista dos 50</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-500 dark:text-neutral-400">
            Liga/desliga o módulo &quot;Lista dos 50&quot; (Novembro Black) pra toda a organização — enquanto desligada, o ícone some
            do menu e a página mostra um aviso em vez do formulário. Desligar não apaga nada: a etapa e os negócios já
            entregues ficam guardados, prontos pra religar na próxima temporada.
          </p>
          <p className="mt-3 text-sm">
            Status agora:{" "}
            <span className={`font-semibold ${live ? "text-green-600 dark:text-green-400" : "text-neutral-500"}`}>
              {live ? "Ligada e ao vivo" : config.enabled ? "Ligada, mas ainda não começou" : "Desligada"}
            </span>
            {config.enabled && config.startsOn && (
              <span className="text-neutral-500 dark:text-neutral-400">
                {" "}
                — início:{" "}
                {config.startsOn.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })}
              </span>
            )}
          </p>
        </div>

        {/* Fundo escuro de propósito — Lista50AdminToggle usa as cores fixas
            da identidade visual da campanha (preto/amarelo), iguais nos dois
            lugares em que aparece (aqui e em /lista-50); num card claro do
            tema padrão do CRM o contraste do texto ficaria ruim. */}
        <div className="max-w-md rounded-xl bg-[#0a0a0c] p-5">
          <Lista50AdminToggle enabled={config.enabled} totalDelivered={totalDelivered} />
        </div>
      </div>
    );
  });
}
