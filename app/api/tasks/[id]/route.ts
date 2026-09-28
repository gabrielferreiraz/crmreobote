import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { USER_PUBLIC_SELECT } from "@/lib/user-public";
import { requireRole } from "@/lib/require-role";
import { scopeWhere } from "@/lib/team-scope";
import { getSharedScope } from "@/lib/share-groups";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { recordUserChange } from "@/lib/user-activity";
import { hasCalendarWriteScope } from "@/lib/google-calendar-oauth";
import { parseBrazilDateTime } from "@/lib/timezone";
import { recordUndoableAction } from "@/lib/undo/record";
import { validateTaskLinks } from "@/lib/task-link-guard";
import type { DeleteSnapshotPayload, FieldUpdatePayload } from "@/lib/undo/types";

export const dynamic = "force-dynamic";

const VALID_MEETING_OUTCOMES = ["ATTENDED", "NO_SHOW", "RESCHEDULED"] as const;

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { title, description, dueAt, completed, meetingOutcome, dealId, contactId } = body as {
    title?: string;
    description?: string;
    dueAt?: string | null;
    completed?: boolean;
    // Resultado de Videochamada/Visita — perguntado na CONCLUSÃO da Task (ver
    // components/meeting-outcome-dialog.tsx), não mais na criação. PENDING
    // não é aceito aqui: é um estado só interno (Activity recém-criada,
    // ainda sem resposta), nunca algo que o cliente manda de propósito.
    meetingOutcome?: "ATTENDED" | "NO_SHOW" | "RESCHEDULED";
    // Trocar o negócio/contato vinculado (ver EditTaskDialog em
    // task-detail-modal.tsx) — `undefined` (campo ausente do body) nunca
    // toca o vínculo atual, igual todo o resto deste PUT; `null`/"" limpa o
    // vínculo; um id troca pra outro negócio/contato. Pedido explícito:
    // qualquer papel com acesso à tarefa pode trocar, não só o Dono.
    dealId?: string | null;
    contactId?: string | null;
  };

  if (meetingOutcome !== undefined && !VALID_MEETING_OUTCOMES.includes(meetingOutcome)) {
    return NextResponse.json({ error: "meetingOutcome inválido" }, { status: 400 });
  }
  if (meetingOutcome === "RESCHEDULED" && !dueAt) {
    return NextResponse.json({ error: "Informe a nova data/horário da remarcação" }, { status: 400 });
  }

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  // Copiado pra variável própria — dentro de resolveLinkedActivity (função
  // aninhada abaixo) o TS não carrega o estreitamento de `access.ok` feito
  // aqui em cima, então `access.organizationId` lá dentro voltaria a ser
  // `string | null`.
  const { organizationId, userId: accessUserId } = access;

  return runWithTenant(organizationId, async () => {
    // Colaborativo: quem compartilha a agenda OU o negócio ligado a esta
    // tarefa (qualquer um dos dois já basta) pode editar/concluir como
    // coautor — este endpoint é usado tanto pela Agenda quanto pelo
    // detalhe do negócio (ver lib/share-groups.ts).
    const scope = await getSharedScope(organizationId, accessUserId, access.role, ["shareAgenda", "shareDeals"]);
    const existing = await prisma.task.findFirst({
      where: { id, organizationId, ...scopeWhere(scope) },
      include: { activity: true },
    });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const isMeetingOrVisit = existing.type === "VIDEO_CALL" || existing.type === "VISIT";
    if (meetingOutcome !== undefined && !isMeetingOrVisit) {
      return NextResponse.json({ error: "meetingOutcome só se aplica a Videochamada/Visita" }, { status: 400 });
    }

    // Mesma validação de POST /api/tasks (lib/task-link-guard.ts): trocar o
    // vínculo só pra negócio/contato dentro do escopo de quem pede. Só valida
    // o que MUDOU — o vínculo atual já foi aceito antes.
    const newDealId = dealId && dealId !== existing.dealId ? dealId : undefined;
    const newContactId = contactId && contactId !== existing.contactId ? contactId : undefined;
    if (newDealId || newContactId) {
      const links = await validateTaskLinks({
        organizationId,
        userId: accessUserId,
        role: access.role,
        dealId: newDealId,
        contactId: newContactId,
      });
      if (!links.ok) return NextResponse.json({ error: links.error }, { status: 400 });
    }

    // ── Validação ANTES de qualquer escrita ────────────────────────────────
    // (antes a Activity era criada e SÓ DEPOIS vinha o 400 "informe o
    // resultado" — deixava uma Activity PENDING órfã a cada tentativa.)
    if (completed === true && isMeetingOrVisit && meetingOutcome !== "RESCHEDULED") {
      const currentOutcome = meetingOutcome ?? existing.activity?.meetingOutcome;
      // Obrigatório de verdade — não só na UI: fecha a brecha de chamar a
      // API direto sem passar pelo diálogo (components/meeting-outcome-dialog.tsx).
      if (!currentOutcome || currentOutcome === "PENDING") {
        return NextResponse.json({ error: "Informe o resultado da videochamada/visita antes de concluir" }, { status: 400 });
      }
    }

    const newDue = meetingOutcome === "RESCHEDULED" ? parseBrazilDateTime(dueAt!) : null;

    const updateData = {
      title,
      description,
      dealId: dealId === undefined ? undefined : dealId || null,
      contactId: contactId === undefined ? undefined : contactId || null,
      // RESCHEDULED nunca toca o dueAt desta Task — o dueAt recebido é da
      // TAREFA NOVA (criada abaixo); esta mantém a data original do
      // encontro que de fato foi tentado, pra ficar registrado quando
      // aconteceu de verdade, não sobrescrito pela data nova.
      dueAt:
        meetingOutcome === "RESCHEDULED"
          ? undefined
          : dueAt === undefined
            ? undefined
            : dueAt
              ? parseBrazilDateTime(dueAt)
              : null,
      // RESCHEDULED finaliza esta tentativa (ver comentário abaixo) — não
      // fica mais em aberto esperando o próximo encontro, isso já é
      // responsabilidade da Task nova.
      completedAt:
        meetingOutcome === "RESCHEDULED" ? new Date() : completed === undefined ? undefined : completed ? new Date() : null,
    };

    // ── Escritas numa transação só (auditoria 09/2026) ──────────────────────
    // Remarcar grava até 5 coisas (Activity nova ou atualizada, log na
    // timeline, Task nova, Task antiga concluída). Soltas, uma falha no meio
    // deixava tarefa, Activity e timeline dizendo coisas diferentes (ex.:
    // encontro novo criado mas o antigo ainda em aberto). prismaRaw com
    // CALLBACK — a forma em array não é atômica neste setup (ver
    // lib/proposals/service.ts).
    const task = await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, organizationId);

      // Liga (ou cria na hora, pra Task antiga sem uma) a Activity que
      // representa esta Videochamada/Visita. Só quando de fato precisa mexer
      // no resultado — edição comum (só título/data) não escreve à toa.
      async function resolveLinkedActivity() {
        if (existing!.activity) return existing!.activity;
        const created = await tx.activity.create({
          data: {
            organizationId,
            dealId: existing!.dealId,
            contactId: existing!.contactId,
            userId: accessUserId,
            // Só chamada quando isMeetingOrVisit já foi confirmado —
            // TaskType e ActivityType não são o mesmo tipo pro TS.
            type: existing!.type as "VIDEO_CALL" | "VISIT",
            body: existing!.title,
            meetingOutcome: "PENDING",
          },
        });
        await tx.task.update({ where: { id: existing!.id }, data: { activityId: created.id } });
        return created;
      }

      if (meetingOutcome === "RESCHEDULED" && newDue) {
        const activity = await resolveLinkedActivity();
        await tx.activity.update({ where: { id: activity.id }, data: { meetingOutcome: "RESCHEDULED" } });
        // Log visível na timeline de que houve trabalho aqui. Formatado no fuso
        // de Campo Grande — o servidor roda em UTC e, sem timeZone, o horário
        // aparecia 4h adiantado (ex.: "às 18:00" pra um encontro das 14:00).
        const when = newDue.toLocaleString("pt-BR", {
          timeZone: "America/Campo_Grande",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        const [datePart, timePart] = when.split(", ");
        await tx.activity.create({
          data: {
            organizationId,
            dealId: existing.dealId,
            contactId: existing.contactId,
            userId: accessUserId,
            type: "SYSTEM",
            body: `${existing.type === "VIDEO_CALL" ? "Videochamada" : "Visita"} remarcada para ${datePart} às ${timePart}`,
          },
        });
        // Pedido explícito: remarcar precisa FINALIZAR esta tentativa (registra
        // que o consultor foi atrás, mesmo sem sucesso — ver completedAt abaixo)
        // em vez de só editar a mesma Task pra frente. Era assim antes
        // ("nunca conclui junto, senão fica um estado contraditório"), mas isso
        // apagava o rastro do encontro original — a MESMA linha virava ora "a
        // tentativa de dia X", ora "o encontro remarcado pra dia Y", e o
        // relatório de videochamada/visita (ver lib/reports/commercial-data.ts)
        // contava esse encontro remarcado como se tivesse acontecido. Uma Task
        // NOVA (não ligada à Activity antiga — cada encontro tem seu próprio
        // resultado no futuro) representa o próximo encontro; a antiga fica
        // completa, com a data original intacta, e o outcome RESCHEDULED nela
        // já garante que a taxa de comparecimento e o ranking de videochamadas (que
        // só contam ATTENDED, nunca RESCHEDULED/PENDING) não a contem como
        // videochamada de fato realizada. Não copia googleEventId/googleMeetLink/
        // lembretes da tarefa antiga — são de OUTRO horário, carregar isso pra
        // cá silenciosamente apontaria pro evento/link errado; o consultor
        // configura de novo pro novo horário se quiser (mesmo fluxo de marcar
        // uma videochamada nova).
        await tx.task.create({
          data: {
            organizationId,
            dealId: existing.dealId,
            contactId: existing.contactId,
            ownerId: existing.ownerId,
            type: existing.type,
            title: existing.title,
            description: existing.description,
            dueAt: newDue,
          },
        });
      } else if (completed === true && isMeetingOrVisit && meetingOutcome) {
        const activity = await resolveLinkedActivity();
        await tx.activity.update({ where: { id: activity.id }, data: { meetingOutcome } });
      }

      return tx.task.update({
        where: { id },
        data: updateData,
        include: { deal: true, contact: true, owner: { select: USER_PUBLIC_SELECT } },
      });
    });

    recordUserChange(organizationId, accessUserId).catch((err) =>
      console.error("[user-activity] falha ao registrar alteração", err),
    );

    // Ctrl+Z (ver lib/undo/) — só no ramo simples. RESCHEDULED fica de fora
    // de propósito: cria uma tarefa nova + mexe na Activity ligada, tem
    // semântica própria que o handler genérico de campo não cobre (ver
    // plano em C:\Users\Gabriel\.claude\plans\wise-dazzling-grove.md).
    let undo: { id: string; description: string } | undefined;
    if (meetingOutcome !== "RESCHEDULED") {
      const changedKeys = (Object.keys(updateData) as (keyof typeof updateData)[]).filter((k) => updateData[k] !== undefined);
      if (changedKeys.length > 0) {
        const previousValues: Record<string, unknown> = {};
        for (const key of changedKeys) previousValues[key] = existing[key as keyof typeof existing];

        // "concluída"/"reaberta" é o texto certo quando completedAt foi o
        // único campo tocado (o caso mais comum de longe — concluir/reabrir
        // uma tarefa pelo checkbox); qualquer outra combinação de campos
        // (título, descrição, vínculo, data) cai no texto genérico.
        const onlyCompletedChanged = changedKeys.length === 1 && changedKeys[0] === "completedAt";
        const actionLabel = onlyCompletedChanged ? (updateData.completedAt ? "concluída" : "reaberta") : "atualizada";
        const undoLabel = onlyCompletedChanged ? (updateData.completedAt ? "reaberta" : "concluída") : "revertida";

        undo = await recordUndoableAction({
          organizationId,
          userId: accessUserId,
          type: "task.update",
          description: `Tarefa "${existing.title}" ${actionLabel}`,
          payload: {
            entities: [{ model: "task", entityId: id, previousValues }],
            descriptions: {
              afterRevert: `Tarefa "${existing.title}" ${undoLabel}`,
              original: `Tarefa "${existing.title}" ${actionLabel}`,
            },
          } satisfies FieldUpdatePayload,
        });
      }
    }

    // Mesmo campo computado de POST /api/tasks — reaproveitado quando
    // reagendar uma Videochamada reabre o MeetingInviteDialog (ver saveTask/
    // deal-detail.tsx), pra oferecer "criar link do Meet" de novo pro
    // horário novo.
    let ownerGoogleCalendarWriteConnected = false;
    if (task.type === "VIDEO_CALL") {
      const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId: task.ownerId } });
      ownerGoogleCalendarWriteConnected = !!connection && hasCalendarWriteScope(connection.scope);
    }

    return NextResponse.json({ ...task, ownerGoogleCalendarWriteConnected, undo });
  });
}

// Excluir tarefa (qualquer tipo — Videochamada/Visita incluídos): pedido mais
// recente reverteu a restrição anterior ("só o Dono decide apagar", ainda
// documentada no histórico do repositório) — agora qualquer papel com
// acesso à tarefa pode excluir, igual já valia pra editar/concluir (PUT
// acima). Continua exigindo autenticação/escopo normal (getSharedScope,
// mesma regra colaborativa do PUT) — só amplia QUEM entre os que já
// enxergam a tarefa pode apagar, nunca deixa apagar algo fora do escopo de
// visão de quem pediu.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const scope = await getSharedScope(access.organizationId, access.userId, access.role, ["shareAgenda", "shareDeals"]);
    const existing = await prisma.task.findFirst({
      where: { id, organizationId: access.organizationId, ...scopeWhere(scope) },
    });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    await prisma.task.delete({ where: { id } });
    recordUserChange(access.organizationId, access.userId).catch((err) =>
      console.error("[user-activity] falha ao registrar alteração", err),
    );

    // Ctrl+Z (ver lib/undo/) — `existing` já é a linha inteira (sem select
    // estreitando), então já É o snapshot que lib/undo/handlers.ts precisa
    // pra recriar preservando o mesmo id.
    const undo = await recordUndoableAction({
      organizationId: access.organizationId,
      userId: access.userId,
      type: "task.delete",
      description: `Tarefa "${existing.title}" excluída`,
      payload: {
        snapshot: existing,
        descriptions: { afterRevert: `Tarefa "${existing.title}" restaurada`, original: `Tarefa "${existing.title}" excluída` },
      } satisfies DeleteSnapshotPayload,
    });

    return NextResponse.json({ ok: true, undo });
  });
}
