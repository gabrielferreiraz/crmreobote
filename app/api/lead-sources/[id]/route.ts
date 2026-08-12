import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { label, countsAsAd } = body as { label?: string; countsAsAd?: boolean };

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (label !== undefined && !label.trim()) {
    return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    const source = await prisma.leadSource.findFirst({
      where: { id, organizationId: access.organizationId },
    });
    if (!source) return NextResponse.json({ error: "Origem não encontrada" }, { status: 404 });

    // label é opcional agora (ver toggle de countsAsAd em source-manager.tsx,
    // que manda só { countsAsAd } sem mexer no nome) — sem valor novo, mantém
    // o atual e pula toda a lógica de renomear/fundir abaixo.
    const trimmedLabel = label !== undefined ? label.trim() : source.label;

    if (trimmedLabel !== source.label) {
      // Contact.source é texto livre, não FK (ver schema) — sem isso, editar
      // aqui só mudava o rótulo da lista e deixava todo contato que já usava
      // o texto antigo órfão, pendurado num valor que sumiu da lista.
      await prisma.contact.updateMany({
        where: { organizationId: access.organizationId, source: source.label },
        data: { source: trimmedLabel },
      });

      // Já existe outra origem com esse nome exato? Funde nela (apaga esta)
      // em vez de deixar duas origens com o mesmo rótulo na lista — o
      // countsAsAd desta requisição, se veio, aplica na que sobrou.
      const existing = await prisma.leadSource.findFirst({
        where: { organizationId: access.organizationId, label: trimmedLabel, id: { not: id } },
      });
      if (existing) {
        await prisma.leadSource.delete({ where: { id } });
        const merged =
          countsAsAd !== undefined
            ? await prisma.leadSource.update({ where: { id: existing.id }, data: { countsAsAd } })
            : existing;
        return NextResponse.json(merged);
      }
    }

    const updated = await prisma.leadSource.update({
      where: { id },
      data: { label: trimmedLabel, ...(countsAsAd !== undefined ? { countsAsAd } : {}) },
    });

    return NextResponse.json(updated);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const source = await prisma.leadSource.findFirst({
      where: { id, organizationId: access.organizationId },
    });
    if (!source) return NextResponse.json({ error: "Origem não encontrada" }, { status: 404 });

    // Não é FK — checa quantos contatos usam esse texto exato antes de excluir.
    const contactCount = await prisma.contact.count({
      where: { organizationId: access.organizationId, source: source.label },
    });
    if (contactCount > 0) {
      return NextResponse.json(
        { error: "Existem contatos usando esta origem" },
        { status: 409 },
      );
    }

    await prisma.leadSource.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
