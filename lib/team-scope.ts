import { prisma } from "@/lib/prisma";

export type DealScope = { type: "all" } | { type: "owners"; ownerIds: string[] };

/**
 * Donos (OWNER) sempre enxergam tudo. Gerentes (MANAGER) enxergam a união
 * das equipes que o Dono atribuiu a eles (Team.managerId — podem
 * supervisionar várias equipes/supervisores ao mesmo tempo). Supervisores
 * (SUPERVISOR) enxergam só a própria equipe (Team.leaderId). Consultores
 * (MEMBER) só enxergam os próprios negócios.
 *
 * Sem equipe atribuída/liderada, Gerente e Supervisor caem no fallback mais
 * RESTRITO (só os próprios negócios) — nunca no mais aberto. Isso é
 * deliberado: o desenho anterior (ADMIN sem equipe = vê tudo) era uma folha
 * de segurança desnecessária, já que "sem equipe" não deveria significar
 * "acesso total" por padrão.
 */
export async function getDealScope(
  organizationId: string,
  userId: string,
  role: string | undefined,
): Promise<DealScope> {
  if (role === "OWNER") return { type: "all" };

  if (role === "MANAGER") {
    const teams = await prisma.team.findMany({
      where: { organizationId, managerId: userId },
      include: { members: { select: { userId: true } } },
    });
    if (teams.length === 0) return { type: "owners", ownerIds: [userId] };
    const ownerIds = new Set(teams.flatMap((t) => t.members.map((m) => m.userId)));
    // O líder (Supervisor) de cada equipe não é necessariamente um "membro"
    // dela (Team.leaderId e OrganizationUser.teamId são independentes) —
    // sem isso, os negócios do próprio Supervisor ficavam invisíveis pro
    // Gerente que supervisiona a equipe dele.
    for (const t of teams) {
      if (t.leaderId) ownerIds.add(t.leaderId);
    }
    ownerIds.add(userId);
    return { type: "owners", ownerIds: Array.from(ownerIds) };
  }

  if (role === "SUPERVISOR") {
    const team = await prisma.team.findFirst({
      where: { organizationId, leaderId: userId },
      include: { members: { select: { userId: true } } },
    });
    if (!team) return { type: "owners", ownerIds: [userId] };
    const ownerIds = new Set(team.members.map((m) => m.userId));
    ownerIds.add(userId);
    return { type: "owners", ownerIds: Array.from(ownerIds) };
  }

  // MEMBER, ou qualquer papel desconhecido/futuro — nunca abre acesso total.
  return { type: "owners", ownerIds: [userId] };
}

export function scopeWhere(scope: DealScope) {
  return scope.type === "owners" ? { ownerId: { in: scope.ownerIds } } : {};
}

/**
 * Mesma ideia de scopeWhere, mas pra WhatsAppMessage (não tem campo de dono
 * próprio, só a relação "instance" — cada vendedor tem seu próprio número
 * conectado, WhatsAppInstance.userId). Filtrar por relação obriga um JOIN;
 * pra WhatsAppThread use whatsappThreadScopeWhere abaixo em vez desta —
 * WhatsAppThread TEM um campo denormalizado (ownerUserId, indexado junto
 * com organizationId) exatamente pra evitar esse join, e usar esta função
 * nele por engano já causou timeout de transação em produção (a lista de
 * Conversas, ver lib/whatsapp/conversations.ts, roda a cada poucos segundos
 * via polling — qualquer query lenta ali dói rápido).
 */
export function whatsappScopeWhere(scope: DealScope) {
  return scope.type === "owners" ? { instance: { userId: { in: scope.ownerIds } } } : {};
}

/**
 * Escopo de "minhas conversas" pra WhatsAppThread especificamente — via
 * ownerUserId (denormalizado, sobrevive à instância ser apagada de verdade
 * quando o dono é desativado, ver o campo no schema), já indexado junto com
 * organizationId. Mesmo campo que toda checagem de autorização de thread já
 * usa (ver app/api/whatsapp/messages/[threadId]/route.ts e afins) — esta
 * função só reaproveita o mesmo padrão pra filtro de lista.
 */
export function whatsappThreadScopeWhere(scope: DealScope) {
  return scope.type === "owners" ? { ownerUserId: { in: scope.ownerIds } } : {};
}

/**
 * Mesma ideia de scopeWhere, mas pra Contact (campo é responsavelId, não
 * ownerId). Usado pelo KPI "Clientes ativos" do Início — antes hardcoded
 * pro usuário logado (não respeitava escopo de equipe), corrigido junto com
 * o redesign.
 */
export function contactScopeWhere(scope: DealScope) {
  return scope.type === "owners" ? { responsavelId: { in: scope.ownerIds } } : {};
}

/**
 * Mesma ideia de scopeWhere, mas pra Campaign (campo é createdById, não
 * ownerId — uma campanha "pertence" a quem criou OU a quem está com o
 * WhatsApp conectado que ela usa, ver o segundo ramo abaixo). Achado em produção: TODA rota de campanha (lista, detalhe,
 * editar, pausar/retomar, apagar, duplicar, enviar agora) filtrava só por
 * organizationId, nunca por quem criou — qualquer Consultor via/mexia na
 * campanha de qualquer outro (relatado: "todos os usuários estavam vendo a
 * campanha um dos outros"), incluindo a lista de destinatários com
 * nome/telefone de cada lead. Mesmo BOLA intra-tenant já achado e corrigido
 * em Deal/Task (ver [[security_posture_2026_07]]), só que este nunca tinha
 * sido migrado pro mesmo padrão.
 */
export function campaignScopeWhere(scope: DealScope) {
  if (scope.type !== "owners") return {};
  const ids = { in: scope.ownerIds };
  return {
    OR: [
      { createdById: ids },
      // Quem está com o WhatsApp conectado da campanha manda nela como se a
      // tivesse criado (pedido do Dono: só ele monta campanha pra outra
      // pessoa, e essa pessoa precisa poder pausar/parar/apagar). Só vale
      // quando a campanha tem UM WhatsApp (MANUAL/LEAD_CAPTURE): no envio em
      // massa do Pipeline a campanha junta o celular de vários consultores e
      // um deles não pode apagar/pausar o envio dos outros.
      { source: { not: "PIPELINE_BULK" as const }, instance: { userId: ids } },
    ],
  };
}

/**
 * Quem pode VER uma campanha — superset de campaignScopeWhere (quem gerencia,
 * vê): soma o envio em massa (PIPELINE_BULK) em que algum destinatário saiu
 * do WhatsApp de alguém do escopo. Aí a pessoa só ENXERGA (e só os próprios
 * destinatários, ver campaignRecipientVisibilityWhere), não gerencia.
 * Relatado: consultores não viam campanhas que saíam do celular deles porque
 * a visibilidade era só por quem criou. Mesma leitura "dono = dono do
 * WhatsApp que envia" que os relatórios já usam.
 */
export function campaignVisibilityWhere(scope: DealScope) {
  if (scope.type !== "owners") return {};
  const ids = { in: scope.ownerIds };
  return {
    OR: [
      ...campaignScopeWhere(scope).OR!,
      { source: "PIPELINE_BULK" as const, recipients: { some: { instance: { userId: ids } } } },
    ],
  };
}

/**
 * Complemento de campaignVisibilityWhere pros DESTINATÁRIOS (nome/telefone de
 * lead): quem só enxerga um envio em massa por ter o WhatsApp usado nele vê
 * apenas os destinatários que saíram do PRÓPRIO WhatsApp (ou do escopo) — os
 * negócios dos outros consultores, misturados na mesma campanha, não são
 * dele (mesmo BOLA intra-tenant de Deal/Task). Quem gerencia a campanha vê a
 * lista inteira, como sempre.
 */
export function campaignRecipientVisibilityWhere(scope: DealScope) {
  if (scope.type !== "owners") return {};
  const ids = { in: scope.ownerIds };
  return {
    OR: [
      { campaign: { createdById: ids } },
      { campaign: { source: { not: "PIPELINE_BULK" as const } } },
      { instance: { userId: ids } },
    ],
  };
}

/** Pode gerenciar — mesma regra de campaignScopeWhere, em forma de checagem sobre uma campanha já carregada. */
export function canManageCampaign(
  scope: DealScope,
  campaign: { createdById: string; source: string; instanceUserId: string },
): boolean {
  if (scope.type === "all") return true;
  return (
    scope.ownerIds.includes(campaign.createdById) ||
    (campaign.source !== "PIPELINE_BULK" && scope.ownerIds.includes(campaign.instanceUserId))
  );
}
