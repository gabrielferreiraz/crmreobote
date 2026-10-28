import { NextResponse } from "next/server";
import { prismaRaw } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { bodyErrorResponse, readJson } from "@/lib/read-body";

export const dynamic = "force-dynamic";

/** Tag gravada em Contact.tags — é por ela que Clientes filtra quem já saiu
 * do pós-venda. String fixa (não vem do cliente) porque é um filtro salvo:
 * "Contemplados", "contemplado" e "contemplados " seriam três tags
 * diferentes na lista, e o filtro só acharia uma delas. */
export const CONTEMPLADO_TAG = "contemplados";

/**
 * Processos -> Clientes: grava o responsável do cliente e marca a tag de
 * contemplado quando o processo se encerra.
 *
 * Mora em /api/contacts (e não em /api/processes) de propósito: quem escreve
 * é Clientes — a rota só toca em Contact. O que chega de Processos é o
 * `processId`, porque o contato pode ainda não existir: processo criado a
 * partir da lista do administrativo tem só `clientName`, e nesse caso o
 * cliente nasce aqui, já com responsável e tag.
 *
 * Permissão: a mesma de editar processo (admin do pós-venda). Consultor
 * comum enxerga o processo mas não muda cadastro de cliente por este caminho.
 */
export async function POST(req: Request) {
  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  let body: { processId?: string; responsavelId?: string };
  try {
    body = await readJson(req);
  } catch (err) {
    const response = bodyErrorResponse(err);
    if (response) return response;
    throw err;
  }

  const processId = typeof body.processId === "string" ? body.processId.trim() : "";
  const responsavelId = typeof body.responsavelId === "string" ? body.responsavelId.trim() : "";
  if (!processId) return NextResponse.json({ error: "processId é obrigatório" }, { status: 400 });
  if (!responsavelId) return NextResponse.json({ error: "Selecione um responsável" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const organizationId = access.organizationId;

    // Transação porque são três escritas que só fazem sentido juntas (criar o
    // contato, marcá-lo e amarrá-lo ao processo): com o contato criado e o
    // vínculo falhando, a próxima tentativa criaria um segundo cadastro com o
    // mesmo nome.
    const result = await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, organizationId);

      const process = await tx.process.findFirst({
        where: { id: processId, organizationId },
        select: { id: true, contactId: true, clientName: true },
      });
      if (!process) return { error: "Processo não encontrado", status: 404 } as const;

      // O responsável precisa ser membro ATIVO desta organização. Sem esta
      // checagem, um id qualquer vindo do corpo gravaria um responsável que
      // não aparece em lista nenhuma — o cliente ficaria "de alguém" que a
      // tela não sabe mostrar.
      const member = await tx.organizationUser.findFirst({
        where: { organizationId, userId: responsavelId, active: true },
        select: { userId: true },
      });
      if (!member) return { error: "Responsável não é um membro ativo", status: 400 } as const;

      if (process.contactId) {
        const contact = await tx.contact.findFirst({
          where: { id: process.contactId, organizationId },
          select: { id: true, tags: true },
        });
        if (!contact) return { error: "Cliente não encontrado", status: 404 } as const;

        // `push` do Postgres acrescentaria a tag de novo a cada salvamento:
        // a lista aceita repetição, e o filtro de Clientes passaria a mostrar
        // "contemplados (3)" pro mesmo cliente. Só grava quando falta.
        const tags = contact.tags.includes(CONTEMPLADO_TAG) ? contact.tags : [...contact.tags, CONTEMPLADO_TAG];

        const updated = await tx.contact.update({
          where: { id: contact.id },
          data: { responsavelId, tags },
          select: { id: true, name: true, tags: true, responsavelId: true },
        });
        return { contact: updated, created: false } as const;
      }

      // Processo sem contato: só existe o rótulo `clientName`. O cliente é
      // criado agora (decisão do usuário) e o processo passa a apontar pra
      // ele, de modo que o nome deixa de viver em dois lugares.
      const name = (process.clientName ?? "").trim();
      if (!name) return { error: "Processo sem nome de cliente", status: 400 } as const;

      // Mesmo critério de "já existe" que a criação de processo usa
      // (lib/processes/create.ts): nome igual, ignorando caixa. Evita um
      // segundo cadastro pra quem já está em Clientes com outro vínculo.
      const existing = await tx.contact.findFirst({
        where: { organizationId, name: { equals: name, mode: "insensitive" } },
        select: { id: true, tags: true },
      });

      const contact = existing
        ? await tx.contact.update({
            where: { id: existing.id },
            data: {
              responsavelId,
              tags: existing.tags.includes(CONTEMPLADO_TAG) ? existing.tags : [...existing.tags, CONTEMPLADO_TAG],
            },
            select: { id: true, name: true, tags: true, responsavelId: true },
          })
        : await tx.contact.create({
            data: { organizationId, name, responsavelId, tags: [CONTEMPLADO_TAG] },
            select: { id: true, name: true, tags: true, responsavelId: true },
          });

      await tx.process.update({
        where: { id: process.id },
        data: { contactId: contact.id, clientName: null },
      });

      return { contact, created: !existing } as const;
    });

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  });
}
