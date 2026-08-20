/**
 * Horário de atendimento da organização — janela única (não por regra de
 * automação), usada pelo gatilho MESSAGE_RECEIVED via `businessHoursMode`
 * (ver lib/automations/message-trigger.ts). GET liberado pra qualquer
 * membro (a tela de criar automação precisa saber se já existe janela
 * configurada, mesmo sem poder editar); PUT só OWNER/MANAGER.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import type { Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const organization = await prisma.organization.findUnique({
      where: { id: access.organizationId },
      select: { businessHours: true },
    });
    return NextResponse.json({ businessHours: organization?.businessHours ?? null });
  });
}

export async function PUT(req: Request) {
  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { start, end, days, holidays } = body as {
    start?: string;
    end?: string;
    days?: number[];
    holidays?: string[];
  };

  if (!start || !TIME_RE.test(start)) return NextResponse.json({ error: "Horário de início inválido" }, { status: 400 });
  if (!end || !TIME_RE.test(end)) return NextResponse.json({ error: "Horário de término inválido" }, { status: 400 });
  if (start >= end) return NextResponse.json({ error: "O horário de início precisa ser antes do término" }, { status: 400 });

  const daysList = Array.isArray(days) ? Array.from(new Set(days)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  if (daysList.length === 0) return NextResponse.json({ error: "Selecione ao menos um dia da semana" }, { status: 400 });

  const holidayList = Array.isArray(holidays) ? Array.from(new Set(holidays)).filter((d) => DATE_RE.test(d)) : [];
  if (Array.isArray(holidays) && holidayList.length !== new Set(holidays).size) {
    return NextResponse.json({ error: "Data de feriado inválida (use AAAA-MM-DD)" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    await prisma.organization.update({
      where: { id: access.organizationId },
      data: {
        businessHours: { start, end, days: daysList, holidays: holidayList } as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ ok: true });
  });
}
