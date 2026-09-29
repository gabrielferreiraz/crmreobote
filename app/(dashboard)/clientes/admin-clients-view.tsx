import { prisma } from "@/lib/prisma";
import { requireProcessAccess, processScopeWhere } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";
import { AdminClientsTable } from "./admin-clients-table";

/**
 * "Clientes" pro Administrativo — bem diferente da lista de Vendas (que
 * mostra todo lead/contato, ganho ou não): aqui só entra quem já deu ganho
 * (tem Process, que só é criado quando o negócio vira WON — ver
 * lib/processes/create.ts), e o Responsável mostrado é sempre o consultor
 * dono do negócio, não o `Contact.responsavelId` (esse é um campo livre de
 * atribuição de conta que pode nem bater com quem vendeu).
 */
export async function AdminClientsView() {
  const access = await requireProcessAccess();
  if (!access.ok) return null;

  return runWithTenant(access.organizationId, async () => {
    const processes = await prisma.process.findMany({
      where: { organizationId: access.organizationId, ...processScopeWhere(access) },
      orderBy: { createdAt: "desc" },
      include: {
        contact: { select: { id: true, name: true, email: true, phone: true, whatsapp: true, jobTitle: true, source: true } },
        owner: { select: { id: true, name: true } },
        stage: { select: { id: true, name: true, color: true } },
        deal: { select: { id: true, name: true } },
      },
    });

    const clients = processes.map((p) => ({
      processId: p.id,
      contact: p.contact,
      owner: p.owner,
      stage: p.stage,
      deal: p.deal,
    }));

    return (
      // /clientes virou rota "app shell" em app-main.tsx (o <main> não rola
      // mais sozinho, ver comentário lá) — precisa da mesma casca de scroll
      // que ContactsTable (a outra tela que esta MESMA rota pode renderizar,
      // conforme o papel de quem está logado), senão uma lista comprida de
      // clientes ganhos ficava cortada, sem nenhuma barra pra rolar até o
      // fim. Sem paginação/rodapé fixo aqui (esta tela não tem — é lista
      // única, filtrada só em memória), só o scroll interno mesmo.
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="shrink-0">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Clientes</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {clients.length} cliente{clients.length === 1 ? "" : "s"} com negócio ganho
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-24 lg:pb-3">
          <AdminClientsTable clients={clients} />
        </div>
      </div>
    );
  });
}
