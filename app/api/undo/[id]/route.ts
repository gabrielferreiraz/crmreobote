import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { reverseUndoableAction } from "@/lib/undo/handlers";
import type { UndoActionType } from "@/lib/undo/types";

export const dynamic = "force-dynamic";

/**
 * Ctrl+Z — desfaz (ou refaz, se `id` já é o registro de "desfazer o
 * desfazer") uma ação registrada por lib/undo/record.ts. Um único
 * endpoint pra qualquer `type`: quem decide COMO reverter é o registry em
 * lib/undo/handlers.ts, não esta rota.
 *
 * Só desfaz ação do PRÓPRIO usuário (organizationId + userId no where) —
 * v1 não abre pra desfazer ação de outra pessoa, mesmo Dono. Sem limite de
 * tempo aqui de propósito: quem decide a janela é o CLIENTE (30s no aviso
 * flutuante via Ctrl+Z/clique; sem prazo na página de histórico, onde
 * clicar "Desfazer" é uma ação deliberada, não um atalho às cegas).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { organizationId, userId } = access;

  return runWithTenant(organizationId, async () => {
    const action = await prisma.undoableAction.findFirst({
      where: { id, organizationId, userId },
    });
    if (!action) return NextResponse.json({ error: "Ação não encontrada" }, { status: 404 });
    if (action.undoneAt) return NextResponse.json({ error: "Essa ação já foi desfeita" }, { status: 409 });

    let result;
    try {
      result = await reverseUndoableAction(action.type as UndoActionType, action.payload, organizationId);
    } catch (err) {
      console.error(`[undo] falha ao reverter ${action.type} (${action.id})`, err);
      return NextResponse.json({ error: "Não foi possível desfazer — o registro pode ter mudado desde então" }, { status: 409 });
    }

    const [, redo] = await prisma.$transaction([
      prisma.undoableAction.update({ where: { id: action.id }, data: { undoneAt: new Date() } }),
      prisma.undoableAction.create({
        data: {
          organizationId,
          userId,
          type: result.type,
          description: result.description,
          payload: result.payload as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);

    return NextResponse.json({ undo: { id: redo.id, description: redo.description } });
  });
}
