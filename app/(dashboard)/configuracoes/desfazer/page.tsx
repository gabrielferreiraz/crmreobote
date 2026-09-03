import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope } from "@/lib/team-scope";
import { UndoHistoryView } from "./undo-history-view";

const MAX_ACTIONS = 200;

/**
 * Histórico de tudo que já passou pelo Ctrl+Z (ver components/undo-provider.tsx
 * e lib/undo/) — o aviso flutuante some sozinho depois de 30s, esta página
 * fica pra sempre: clicar "Desfazer" aqui não tem prazo, é uma ação
 * deliberada, não um atalho às cegas.
 *
 * Mesmo escopo de visibilidade de Agenda/Pipeline (getDealScope) — não
 * restrito a Dono como a Auditoria de segurança (ver
 * configuracoes/auditoria/page.tsx): Consultor só vê as PRÓPRIAS ações
 * (userId, não ownerId — UndoableAction não tem "dono do negócio", tem
 * "quem fez"), Gerente/Supervisor a equipe, Dono tudo.
 */
export default async function DesfazerPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const userId = session!.user.id;

  const actions = await runWithTenant(organizationId, async () => {
    const scope = await getDealScope(organizationId, userId, session!.user.role);
    return prisma.undoableAction.findMany({
      where: {
        organizationId,
        ...(scope.type === "owners" ? { userId: { in: scope.ownerIds } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: MAX_ACTIONS,
      include: { user: { select: { name: true } } },
    });
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Desfazer ações</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Últimas {MAX_ACTIONS} ações que dá pra desfazer com Ctrl+Z — exclusão, edição de campo e movimentação de
          etapa/dia. Sem prazo aqui, diferente do aviso que aparece na hora: clique em &quot;Desfazer&quot; quando quiser.
        </p>
      </div>

      <UndoHistoryView
        initialActions={actions.map((a) => ({
          id: a.id,
          description: a.description,
          actorName: a.user.name,
          undoneAt: a.undoneAt?.toISOString() ?? null,
          createdAt: a.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
