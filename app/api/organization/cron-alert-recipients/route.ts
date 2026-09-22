/**
 * Quem, entre os donos ATIVOS desta organização, recebe o e-mail técnico de
 * "cron parou de rodar" (ver lib/system-alerts.ts) — complementa o
 * interruptor geral "cronAlerts" de /api/organization/email-notifications:
 * aquele liga/desliga pra organização inteira, este exclui pessoas
 * específicas sem desligar pros outros donos (pedido explícito: sócio
 * não-técnico não precisa ver alerta de infraestrutura, mas quem cuida do
 * sistema continua recebendo). Só OWNER acessa — mesmo motivo do outro
 * endpoint (não é config operacional de MANAGER).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const owners = await prisma.organizationUser.findMany({
      where: { role: "OWNER", active: true },
      orderBy: { user: { name: "asc" } },
      select: { id: true, receiveCronAlerts: true, user: { select: { id: true, name: true, email: true } } },
    });
    return NextResponse.json({ owners });
  });
}

export async function PATCH(req: Request) {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { organizationUserId, receiveCronAlerts } = body as { organizationUserId?: string; receiveCronAlerts?: boolean };
  if (!organizationUserId || typeof receiveCronAlerts !== "boolean") {
    return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    // where com organizationId+role — nunca confia cru no organizationUserId
    // recebido: sem isso, um dono de uma organização poderia tentar mexer no
    // registro de outra só adivinhando o id (RLS já bloquearia a leitura,
    // mas o updateMany explícito deixa a intenção clara e devolve 404 certo).
    const result = await prisma.organizationUser.updateMany({
      where: { id: organizationUserId, organizationId: access.organizationId, role: "OWNER" },
      data: { receiveCronAlerts },
    });
    if (result.count === 0) return NextResponse.json({ error: "Dono não encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true });
  });
}
