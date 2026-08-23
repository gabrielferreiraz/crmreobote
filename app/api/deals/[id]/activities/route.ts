import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { scopeWhere } from "@/lib/team-scope";
import { getSharedScope } from "@/lib/share-groups";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(access.organizationId, async () => {
    const scope = await getSharedScope(access.organizationId, access.userId, access.role, "shareDeals");
    const deal = await prisma.deal.findFirst({
      where: { id, organizationId: access.organizationId, ...scopeWhere(scope) },
    });
    if (!deal) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const activities = await prisma.activity.findMany({
      where: { dealId: id },
      orderBy: { createdAt: "desc" },
      include: { user: true },
    });

    return NextResponse.json(activities);
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { type, activityBody, meetingOutcome } = body as { type?: string; activityBody?: string; meetingOutcome?: string };

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { organizationId, userId } = access;

  const validTypes = ["NOTE", "EMAIL", "CALL", "WHATSAPP", "PROPOSAL", "MEETING", "VISIT"];
  if (!type || !validTypes.includes(type)) {
    return NextResponse.json({ error: "type inválido" }, { status: 400 });
  }

  // Só cabe pergunta de "o que aconteceu" pra Reunião/Visita — outro tipo
  // de atividade (nota, ligação, e-mail...) não tem um "resultado" desse
  // jeito, ver ActivityMeetingOutcome no schema. PENDING é o caso normal
  // quando esta Activity vai ganhar uma Task ligada (deal-detail.tsx manda
  // isso e resolve o resultado de verdade só na conclusão da Task); ATTENDED/
  // NO_SHOW/RESCHEDULED direto só quando NÃO há Task nenhuma sendo criada
  // (registro retroativo de algo que já aconteceu — não tem "conclusão"
  // futura pra perguntar depois, então pergunta aqui mesmo).
  const validOutcomes = ["ATTENDED", "NO_SHOW", "RESCHEDULED", "PENDING"];
  if (meetingOutcome !== undefined && !validOutcomes.includes(meetingOutcome)) {
    return NextResponse.json({ error: "meetingOutcome inválido" }, { status: 400 });
  }
  if (meetingOutcome !== undefined && type !== "MEETING" && type !== "VISIT") {
    return NextResponse.json({ error: "meetingOutcome só se aplica a Reunião/Visita" }, { status: 400 });
  }
  // Reunião/Visita sempre precisa de uma resposta (PENDING conta como
  // resposta válida aqui) — fecha a brecha de registrar sem nenhum
  // resultado, nem futuro nem imediato.
  if (meetingOutcome === undefined && (type === "MEETING" || type === "VISIT")) {
    return NextResponse.json({ error: "meetingOutcome é obrigatório para Reunião/Visita" }, { status: 400 });
  }

  return runWithTenant(organizationId, async () => {
    // Colaborativo: quem compartilha o negócio via grupo também pode
    // registrar atividade nele como coautor (ver lib/share-groups.ts).
    const scope = await getSharedScope(organizationId, userId, access.role, "shareDeals");
    const deal = await prisma.deal.findFirst({ where: { id, organizationId, ...scopeWhere(scope) } });
    if (!deal) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const activity = await prisma.activity.create({
      data: {
        organizationId,
        dealId: id,
        contactId: deal.contactId,
        userId,
        type: type as
          | "NOTE"
          | "EMAIL"
          | "CALL"
          | "WHATSAPP"
          | "PROPOSAL"
          | "MEETING"
          | "VISIT",
        body: activityBody,
        meetingOutcome: meetingOutcome as "ATTENDED" | "NO_SHOW" | "RESCHEDULED" | "PENDING" | undefined,
      },
      include: { user: true },
    });

    return NextResponse.json(activity, { status: 201 });
  });
}
