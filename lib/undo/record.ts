import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import type { UndoActionType } from "./types";

/**
 * Grava uma ação desfazível (Ctrl+Z, ver lib/undo/handlers.ts pra reverter e
 * app/api/undo/[id]/route.ts pro endpoint que dispara isso). Chamar SEMPRE
 * depois da escrita real já ter tido sucesso — nunca antes: se a mutação
 * de verdade falhar, não faz sentido oferecer "desfazer" algo que nem
 * aconteceu. Mesmo motivo de publishWhatsAppEvent só rodar pós-commit
 * (ver lib/whatsapp/live-events.ts).
 *
 * `payload` é o que o handler do `type` precisa pra reverter — formato
 * específico por type, ver lib/undo/handlers.ts. Nunca serializar aqui,
 * Prisma.Json aceita o objeto direto.
 */
export async function recordUndoableAction(params: {
  organizationId: string;
  userId: string;
  type: UndoActionType;
  description: string;
  payload: unknown;
}): Promise<{ id: string; description: string }> {
  const created = await prisma.undoableAction.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId,
      type: params.type,
      description: params.description,
      payload: params.payload as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, description: true },
  });
  return created;
}
