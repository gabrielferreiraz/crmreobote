import { prisma } from "@/lib/prisma";
import type { ResolveImportInput } from "@/lib/contacts/import-resolve";

/**
 * Entrada do banco que resolveImportPlan precisa — UMA consulta pra prévia
 * (app/api/contacts/import/preview) e pro commit (app/api/contacts/import).
 * Antes cada rota tinha a sua cópia do mesmo select, e um campo novo (o
 * endereço) precisava lembrar de entrar nas duas; esquecer uma fazia a prévia
 * e a importação calcularem coisas diferentes.
 *
 * Roda dentro de runWithTenant (RLS) — chamador garante.
 */
export async function loadContactImportContext(
  organizationId: string,
): Promise<Pick<ResolveImportInput, "existingContacts" | "members" | "inactiveMembers" | "jobTitleOptions" | "sourceOptions">> {
  // Só quem tem telefone OU whatsapp preenchido — os únicos dois campos com
  // constraint única (ver lib/contacts/import-resolve.ts), o resto nunca
  // colide.
  const [existingContactsRaw, allMembers, jobTitles, sources] = await Promise.all([
    prisma.contact.findMany({
      where: { organizationId, OR: [{ phoneNormalized: { not: null } }, { whatsappNormalized: { not: null } }] },
      select: {
        id: true,
        name: true,
        phoneNormalized: true,
        whatsappNormalized: true,
        responsavelId: true,
        responsavel: { select: { name: true } },
        jobTitle: true,
        source: true,
        company: true,
        email: true,
        zipCode: true,
        address: true,
        addressNumber: true,
        addressComplement: true,
        neighborhood: true,
        city: true,
        state: true,
      },
    }),
    // Ativos E inativos — precisa saber se o dono de um contato já
    // cadastrado ainda está ativo, e dizer "está inativo" (não "não
    // encontrado") pra um responsável da planilha que saiu da empresa. Só os
    // ativos viram `members` (quem pode receber contato).
    prisma.organizationUser.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: { active: true, user: { select: { id: true, name: true, email: true } } },
    }),
    // Listas fechadas de Configurações — o mesmo Select do cadastro manual.
    // Valor da planilha fora delas vira pergunta na revisão (ver PendingValue).
    prisma.jobTitle.findMany({ where: { organizationId }, orderBy: { order: "asc" }, select: { label: true } }),
    prisma.leadSource.findMany({ where: { organizationId }, orderBy: { order: "asc" }, select: { label: true } }),
  ]);

  const activeMembers = allMembers.filter((m) => m.active);
  const activeMemberIds = new Set(activeMembers.map((m) => m.user.id));

  return {
    existingContacts: existingContactsRaw.map(({ responsavel, ...c }) => ({
      ...c,
      responsavelName: responsavel?.name ?? null,
      responsavelActive: !!c.responsavelId && activeMemberIds.has(c.responsavelId),
    })),
    members: activeMembers.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email })),
    inactiveMembers: allMembers.filter((m) => !m.active).map((m) => ({ name: m.user.name, email: m.user.email })),
    jobTitleOptions: jobTitles.map((j) => j.label),
    sourceOptions: sources.map((s) => s.label),
  };
}
