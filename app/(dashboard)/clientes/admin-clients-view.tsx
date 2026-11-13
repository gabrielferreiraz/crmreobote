import { prisma } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { getCurrentMembership } from "@/lib/current-membership";
import { runWithTenant } from "@/lib/tenant-context";
import { AdminClientsTable, type ClientRow } from "./admin-clients-table";

const CONTACT_SELECT = { id: true, name: true, email: true, phone: true, whatsapp: true, company: true, jobTitle: true, source: true } as const;

/**
 * "Clientes" para quem não vende — bem diferente da lista de Vendas (que mostra
 * todo lead/contato): aqui entra TODO cliente que já teve um negócio ganho (venda
 * fechada), tenha ou não Processo, mais quem foi cadastrado direto num Processo
 * (cliente já contemplado cuja venda nunca foi registrada aqui). Uma linha por
 * cliente, mesmo com várias vendas. O Responsável é sempre o consultor que
 * vendeu, não o `Contact.responsavelId`.
 *
 * Antes só aparecia quem tinha Processo, e o Processo passou a ser criado à mão
 * ("Adicionar ao processo"): quase todos os clientes ganhos ficavam de fora.
 */
export async function AdminClientsView() {
  const access = await requireProcessAccess();
  if (!access.ok) return null;
  const membership = await getCurrentMembership();
  // Quem cadastra a cota abre a venda direto na tela de Cadastros; o Financeiro e a pós-contemplação, na ficha do cliente.
  const opensRegistration = membership?.area === "ADMINISTRATIVO";
  const canExport = membership?.role === "OWNER" || membership?.area === "ADMINISTRATIVO";
  // Administrativo, Pós-contemplação e Financeiro enxergam todos os clientes ganhos; qualquer outro vê só os próprios.
  const seesAll = access.isAdmin || membership?.area === "FINANCEIRO";
  const ownDealsOnly = seesAll ? {} : { ownerId: access.userId };

  return runWithTenant(access.organizationId, async () => {
    const [wonDeals, processes] = await Promise.all([
      prisma.deal.findMany({
        where: { organizationId: access.organizationId, status: "WON", ...ownDealsOnly },
        orderBy: [{ closedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          name: true,
          value: true,
          grossValue: true,
          closedAt: true,
          contact: { select: CONTACT_SELECT },
          owner: { select: { id: true, name: true } },
          process: { select: { id: true, value: true, groupNumber: true, quotaNumber: true, stage: { select: { id: true, name: true, color: true } } } },
          registration: { select: { quotaRegisteredAt: true, groupNumber: true, quotaNumber: true, quotaDigit: true } },
        },
      }),
      // Processos de cliente (com ou sem negócio ganho): cada contato com processo aparece mesmo sem venda registrada.
      prisma.process.findMany({
        where: { organizationId: access.organizationId, contactId: { not: null }, ...(seesAll ? {} : { ownerId: access.userId }) },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          value: true,
          groupNumber: true,
          quotaNumber: true,
          contact: { select: CONTACT_SELECT },
          owner: { select: { id: true, name: true } },
          stage: { select: { id: true, name: true, color: true } },
          deal: { select: { id: true, name: true, value: true, grossValue: true } },
        },
      }),
    ]);

    // Um processo por cliente (o mais recente) para mostrar a etapa mesmo quando a venda não está ligada a ele.
    const processByContact = new Map<string, (typeof processes)[number]>();
    for (const p of processes) {
      if (p.contact && !processByContact.has(p.contact.id)) processByContact.set(p.contact.id, p);
    }

    const rows = new Map<string, ClientRow>();
    for (const d of wonDeals) {
      const existing = rows.get(d.contact.id);
      if (existing) {
        existing.dealsCount += 1;
        continue;
      }
      const process = d.process ?? processByContact.get(d.contact.id) ?? null;
      const registered = d.registration?.quotaRegisteredAt != null;
      const dealValue = d.grossValue ?? d.value ?? process?.value;
      rows.set(d.contact.id, {
        key: d.contact.id,
        contact: d.contact,
        owner: d.owner,
        deal: { id: d.id, name: d.name },
        value: dealValue == null ? null : Number(dealValue),
        groupNumber: d.registration?.groupNumber ?? process?.groupNumber ?? null,
        quotaNumber: d.registration?.quotaNumber ?? process?.quotaNumber ?? null,
        quotaDigit: d.registration?.quotaDigit ?? null,
        dealsCount: 1,
        wonAt: d.closedAt ? d.closedAt.toISOString() : null,
        badge: process
          ? { label: process.stage.name, color: process.stage.color }
          : d.registration
            ? { label: registered ? "Cota cadastrada" : "Cota a cadastrar", color: registered ? "#16a34a" : "#d97706" }
            : { label: "Venda ganha", color: null },
        href: process
          ? `/processos/${process.id}`
          : opensRegistration && d.registration
            ? `/cadastros/${d.id}`
            : `/clientes/${d.contact.id}`,
      });
    }
    // Clientes cadastrados direto num Processo, sem negócio ganho neste CRM.
    for (const p of processes) {
      if (!p.contact || rows.has(p.contact.id)) continue;
      const processValue = p.deal?.grossValue ?? p.deal?.value ?? p.value;
      rows.set(p.contact.id, {
        key: p.contact.id,
        contact: p.contact,
        owner: p.owner,
        deal: p.deal,
        value: processValue == null ? null : Number(processValue),
        groupNumber: p.groupNumber,
        quotaNumber: p.quotaNumber,
        quotaDigit: null,
        dealsCount: p.deal ? 1 : 0,
        wonAt: null,
        badge: { label: p.stage.name, color: p.stage.color },
        href: `/processos/${p.id}`,
      });
    }
    const clients = Array.from(rows.values());

    return (
      // /clientes é rota "app shell" (ver app-main.tsx): o <main> não rola sozinho, então a lista
      // precisa da própria casca de rolagem — sem paginação de servidor, só filtro em memória.
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="shrink-0">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Clientes</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {clients.length} cliente{clients.length === 1 ? "" : "s"} com venda ganha
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4 lg:pb-3">
          <AdminClientsTable clients={clients} canExport={canExport} />
        </div>
      </div>
    );
  });
}
