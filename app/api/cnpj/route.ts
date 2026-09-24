import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { rateLimitOrResponse, getClientIp } from "@/lib/rate-limit";
import { lookupCnpj, CnpjLookupError, formatCnpj } from "@/lib/cnpj";

export const dynamic = "force-dynamic";

/** A consulta sai pela rede pra uma fonte pública com cota por minuto — sem
 * teto aqui, um formulário em loop (ou alguém segurando a tecla) derruba a
 * cota da organização inteira. Generoso pra uso humano normal, apertado o
 * bastante pra barrar repetição automática. */
const LOOKUP_LIMIT = 20;
const LOOKUP_WINDOW_MS = 60_000;

/**
 * GET /api/cnpj?cnpj=... — consulta o nome da empresa na Receita SEM gravar
 * nada (é o que a tela usa pra mostrar "é esta empresa?" antes de confirmar).
 *
 * GET /api/cnpj (sem parâmetro) — devolve a PJ JÁ CADASTRADA de quem está
 * logado, ou `company: null` se não tem. É por aqui que o aviso de cadastro
 * (components/cnpj-prompt.tsx) decide se aparece ou fica quieto.
 */
export async function GET(req: Request) {
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const cnpj = new URL(req.url).searchParams.get("cnpj");

  if (!cnpj) {
    return runWithTenant(access.organizationId, async () => {
      const company = await prisma.userCompany.findFirst({
        where: { userId: access.userId, organizationId: access.organizationId },
        select: { cnpj: true, name: true },
      });
      return NextResponse.json({
        company: company ? { ...company, cnpjFormatted: formatCnpj(company.cnpj) } : null,
      });
    });
  }

  const limited = rateLimitOrResponse(`cnpj-lookup:${access.userId ?? getClientIp(req)}`, LOOKUP_LIMIT, LOOKUP_WINDOW_MS);
  if (limited) return limited;

  try {
    const result = await lookupCnpj(cnpj);
    return NextResponse.json({ ...result, cnpjFormatted: formatCnpj(result.cnpj) });
  } catch (err) {
    if (err instanceof CnpjLookupError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

/**
 * PUT /api/cnpj — grava a PJ do consultor (ver UserCompany no schema). Sem
 * `userId` no corpo, mexe na própria; com `userId`, mexe na de outra pessoa e
 * aí exige papel de gestão — o caso real é o admin cadastrando pelo time, que
 * de outro jeito dependeria de cada consultor entrar e fazer por conta.
 *
 * Reconsulta a Receita em vez de aceitar o nome vindo do cliente: o GET acima
 * é só pra conferência visual, e confiar no que volta do navegador deixaria
 * qualquer um gravar o nome que quisesse na TV da parede.
 */
export async function PUT(req: Request) {
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const limited = rateLimitOrResponse(`cnpj-save:${access.userId}`, LOOKUP_LIMIT, LOOKUP_WINDOW_MS);
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as { cnpj?: string; userId?: string } | null;
  if (!body?.cnpj) return NextResponse.json({ error: "Informe o CNPJ" }, { status: 400 });

  const rawCnpj = body.cnpj;
  const targetUserId = body.userId ?? access.userId!;
  if (targetUserId !== access.userId && access.role !== "OWNER" && access.role !== "MANAGER") {
    return NextResponse.json({ error: "Só OWNER ou MANAGER pode cadastrar o CNPJ de outra pessoa" }, { status: 403 });
  }

  return runWithTenant(access.organizationId, async () => {
    // Confere que o alvo é do time ANTES de gastar a consulta à Receita — sem
    // isso dava pra gravar uma linha apontando pra um usuário de outra
    // organização (a RLS protege a leitura, não o userId que veio no corpo).
    const membership = await prisma.organizationUser.findFirst({
      where: { organizationId: access.organizationId, userId: targetUserId },
      select: { userId: true },
    });
    if (!membership) return NextResponse.json({ error: "Usuário não encontrado nesta organização" }, { status: 404 });

    let company;
    try {
      company = await lookupCnpj(rawCnpj);
    } catch (err) {
      if (err instanceof CnpjLookupError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }

    const saved = await prisma.userCompany.upsert({
      where: { userId: targetUserId },
      create: {
        organizationId: access.organizationId,
        userId: targetUserId,
        cnpj: company.cnpj,
        name: company.name,
      },
      update: { cnpj: company.cnpj, name: company.name },
      select: { cnpj: true, name: true, updatedAt: true },
    });

    return NextResponse.json({ ...saved, cnpjFormatted: formatCnpj(saved.cnpj) });
  });
}

/**
 * DELETE /api/cnpj[?userId=...] — tira a PJ e devolve a pessoa ao nome
 * pessoal na TV. Mesma regra de alvo do PUT acima.
 */
export async function DELETE(req: Request) {
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const targetUserId = new URL(req.url).searchParams.get("userId") ?? access.userId!;
  if (targetUserId !== access.userId && access.role !== "OWNER" && access.role !== "MANAGER") {
    return NextResponse.json({ error: "Só OWNER ou MANAGER pode remover o CNPJ de outra pessoa" }, { status: 403 });
  }

  return runWithTenant(access.organizationId, async () => {
    // deleteMany (não delete): não existir já é o estado desejado, não erro —
    // `delete` lançaria P2025 e viraria um 500 pra quem clicou duas vezes.
    const { count } = await prisma.userCompany.deleteMany({
      where: { userId: targetUserId, organizationId: access.organizationId },
    });
    return NextResponse.json({ ok: true, removed: count > 0 });
  });
}
