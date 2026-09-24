/**
 * Texto padrão da descrição de proposta (Organization.defaultProposalDescription)
 * — o que preenche o campo "Descrição" quando um consultor cria uma proposta
 * nova. Só OWNER edita: é texto institucional/jurídico que vai impresso com o
 * nome da empresa na mão do cliente, não configuração operacional de
 * consultor. Nunca reescreve proposta já criada (cada uma guarda a própria
 * cópia em Proposal.description), só afeta as PRÓXIMAS.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const MAX_LENGTH = 4000;

export async function PUT(req: Request) {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { description } = body as { description?: unknown };
  if (typeof description !== "string") return NextResponse.json({ error: "Texto inválido" }, { status: 400 });

  const trimmed = description.trim();
  if (trimmed.length > MAX_LENGTH) {
    return NextResponse.json({ error: `Texto acima de ${MAX_LENGTH} caracteres` }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    await prisma.organization.update({
      where: { id: access.organizationId },
      // Vazio = "sem texto padrão" (null), não string vazia — a tela de
      // criação distingue "nada configurado" de "configurado como vazio".
      data: { defaultProposalDescription: trimmed || null },
    });
    return NextResponse.json({ ok: true });
  });
}
