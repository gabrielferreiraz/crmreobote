import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { recordUserChange } from "@/lib/user-activity";
import { recordUndoableAction } from "@/lib/undo/record";
import type { DeleteSnapshotPayload, FieldUpdatePayload } from "@/lib/undo/types";

export const dynamic = "force-dynamic";

const VALID_MEETING_OUTCOMES = ["ATTENDED", "NO_SHOW", "RESCHEDULED", "PENDING"] as const;

async function hasPermission(args: {
  organizationId: string;
  userId: string;
  userRole: string | null | undefined;
  activity: {
    id: string;
    organizationId: string;
    dealId: string | null;
    userId: string;
    type: string;
  };
}): Promise<{ ok: boolean; reason?: string }> {
  const { organizationId, userId, userRole, activity } = args;

  if (activity.organizationId !== organizationId) {
    return { ok: false, reason: "Organização inválida" };
  }

  if (activity.type === "SYSTEM") {
    return { ok: false, reason: "Atividades do sistema não podem ser alteradas" };
  }

  if (userRole === "OWNER") {
    return { ok: true };
  }

  if (activity.userId === userId) {
    return { ok: true };
  }

  if (activity.dealId) {
    const deal = await prisma.deal.findUnique({
      where: { id_organizationId: { id: activity.dealId, organizationId } },
      select: { ownerId: true },
    });
    if (deal && deal.ownerId === userId) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "Sem permissão para alterar esta atividade" };
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { activityBody, meetingOutcome } = body as {
    activityBody?: string;
    meetingOutcome?: "ATTENDED" | "NO_SHOW" | "RESCHEDULED" | "PENDING";
  };

  if (meetingOutcome !== undefined && !VALID_MEETING_OUTCOMES.includes(meetingOutcome)) {
    return NextResponse.json({ error: "meetingOutcome inválido" }, { status: 400 });
  }

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.activity.findUnique({
      where: { id },
    });

    if (!existing || existing.organizationId !== access.organizationId) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    const permission = await hasPermission({
      organizationId: access.organizationId,
      userId: access.userId,
      userRole: access.role,
      activity: existing,
    });

    if (!permission.ok) {
      return NextResponse.json({ error: permission.reason ?? "Sem permissão" }, { status: 403 });
    }

    const isMeetingOrVisit = existing.type === "MEETING" || existing.type === "VISIT";
    if (meetingOutcome !== undefined && !isMeetingOrVisit) {
      return NextResponse.json({ error: "meetingOutcome só se aplica a Reunião/Visita" }, { status: 400 });
    }

    const updateData: { body?: string | null; meetingOutcome?: typeof meetingOutcome } = {};
    if (activityBody !== undefined) {
      updateData.body = activityBody || null;
    }
    if (meetingOutcome !== undefined) {
      updateData.meetingOutcome = meetingOutcome;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ ok: true });
    }

    const updated = await prisma.activity.update({
      where: { id },
      data: updateData,
      include: { user: true },
    });

    recordUserChange(access.organizationId, access.userId).catch((err) =>
      console.error("[user-activity] falha ao registrar alteração", err),
    );

    const changedKeys = (Object.keys(updateData) as (keyof typeof updateData)[]).filter(
      (k) => updateData[k] !== undefined,
    );
    let undo: { id: string; description: string } | undefined;
    if (changedKeys.length > 0) {
      const previousValues: Record<string, unknown> = {};
      for (const key of changedKeys) previousValues[key] = existing[key as keyof typeof existing];

      undo = await recordUndoableAction({
        organizationId: access.organizationId,
        userId: access.userId,
        type: "activity.update",
        description: "Atividade atualizada",
        payload: {
          entities: [{ model: "activity", entityId: id, previousValues }],
          descriptions: {
            afterRevert: "Atividade revertida",
            original: "Atividade atualizada",
          },
        } satisfies FieldUpdatePayload,
      });
    }

    return NextResponse.json({ ...updated, undo });
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.activity.findUnique({
      where: { id },
    });

    if (!existing || existing.organizationId !== access.organizationId) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    const permission = await hasPermission({
      organizationId: access.organizationId,
      userId: access.userId,
      userRole: access.role,
      activity: existing,
    });

    if (!permission.ok) {
      return NextResponse.json({ error: permission.reason ?? "Sem permissão" }, { status: 403 });
    }

    await prisma.activity.delete({ where: { id } });

    recordUserChange(access.organizationId, access.userId).catch((err) =>
      console.error("[user-activity] falha ao registrar alteração", err),
    );

    const undo = await recordUndoableAction({
      organizationId: access.organizationId,
      userId: access.userId,
      type: "activity.delete",
      description: "Atividade excluída",
      payload: {
        snapshot: existing,
        descriptions: { afterRevert: "Atividade restaurada", original: "Atividade excluída" },
      } satisfies DeleteSnapshotPayload,
    });

    return NextResponse.json({ ok: true, undo });
  });
}
