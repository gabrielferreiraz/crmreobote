import { prisma } from "@/lib/prisma";
import { brazilDateKey, getBrazilParts } from "@/lib/timezone";
import { sendPushToUser } from "@/lib/push";

/**
 * Aniversário dos CLIENTES — alimenta o card "Aniversariantes" do Início e o
 * push do primeiro acesso do dia. Pedido explícito: cada pessoa vê só os
 * clientes em que é o RESPONSÁVEL (Contact.responsavelId), nunca por escopo
 * de equipe — Gerente/Supervisor também só veem a própria carteira aqui. A
 * ÚNICA exceção é o Dono, que vê os de todos (`responsavelId: null` em
 * getContactBirthdays) — quem decide isso é quem chama, ver page.tsx do
 * Início.
 *
 * Fonte ÚNICA: Contact.birthDate ("Data de nascimento", ver
 * components/birth-date-input.tsx). Até 09/2026 o dado vivia em dois lugares —
 * a coluna nativa (8 clientes) e um campo personalizado "Aniversário" (14.670,
 * gravado pela importação do Agendor) — e este arquivo lia os dois. Foram
 * unificados em Contact.birthDate (scripts/migrate-birthdays-to-native.ts) e o
 * campo antigo foi apagado; quem for importar aniversário grava direto em
 * birthDate (ver scripts/agendor/import-pessoas.ts).
 */

export type ContactBirthday = {
  contactId: string;
  name: string;
  /** 0 = hoje, 1 = amanhã... */
  daysUntil: number;
  /** Dia (1-31) e mês (1-12) do aniversário. */
  day: number;
  month: number;
  /** Idade que a pessoa completa nesse aniversário — null se o ano gravado não é plausível. */
  turningAge: number | null;
  /** Consultor responsável pelo cliente — o card só mostra isso na visão do Dono (todos os clientes), onde saber "de quem é" importa. */
  responsavelName: string | null;
};

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Os próximos `days` dias a partir de HOJE em Brasília (não em UTC, o
 * servidor roda em UTC — ver lib/timezone.ts), indexados por "MM-DD". Quem
 * nasceu em 29/02 comemora em 28/02 nos anos que não são bissextos.
 */
type WindowDay = { daysUntil: number; year: number; month: number; day: number };

function buildWindow(days: number): Map<string, WindowDay> {
  const { year, month, day } = getBrazilParts(new Date());
  const window = new Map<string, WindowDay>();
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(year, month, day + i));
    const entry: WindowDay = { daysUntil: i, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    window.set(`${pad2(entry.month)}-${pad2(entry.day)}`, entry);
    if (entry.month === 2 && entry.day === 28 && !isLeapYear(entry.year)) window.set("02-29", entry);
  }
  return window;
}

function plausibleAge(birthYear: number, onYear: number): number | null {
  const age = onYear - birthYear;
  return age > 0 && age < 120 ? age : null;
}

/**
 * Aniversariantes dos clientes de `responsavelId` nos próximos `days` dias
 * (1 = só hoje), do mais próximo pro mais distante. `responsavelId: null` =
 * TODOS os clientes da organização (visão do Dono, inclusive os sem
 * responsável). Precisa rodar dentro de runWithTenant (RLS).
 */
export async function getContactBirthdays(
  organizationId: string,
  responsavelId: string | null,
  days: number,
): Promise<ContactBirthday[]> {
  const window = buildWindow(days);
  const found: ContactBirthday[] = [];
  const ownerFilter = responsavelId ? { responsavelId } : {};

  // Só quem TEM data preenchida (e, fora da visão do Dono, só da carteira desta
  // pessoa). São ~15 mil datas no total: trazer só id/nome/data e filtrar dia/mês
  // aqui em JS é barato — o Prisma não filtra por parte de uma coluna DATE.
  const rows = await prisma.contact.findMany({
    where: { organizationId, ...ownerFilter, birthDate: { not: null } },
    select: { id: true, name: true, birthDate: true, responsavel: { select: { name: true } } },
  });

  for (const c of rows) {
    if (!c.birthDate) continue;
    // getUTC*: @db.Date volta como meia-noite UTC, os getters locais podiam
    // ler o dia anterior (mesma armadilha do carrossel da TV, lib/tv-dashboard.ts).
    const birthYear = c.birthDate.getUTCFullYear();
    const hit = window.get(`${pad2(c.birthDate.getUTCMonth() + 1)}-${pad2(c.birthDate.getUTCDate())}`);
    if (!hit) continue;
    found.push({
      contactId: c.id,
      name: c.name,
      daysUntil: hit.daysUntil,
      day: hit.day,
      month: hit.month,
      turningAge: plausibleAge(birthYear, hit.year),
      responsavelName: c.responsavel?.name ?? null,
    });
  }

  return found.sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name, "pt-BR"));
}

// ─── Push do primeiro acesso do dia ──────────────────────────────────

// Evita bater no banco a cada heartbeat (30s, por aba) depois que o dia da
// pessoa já foi resolvido NESTE processo. Só otimização: quem decide de
// verdade é o UPDATE atômico em claimBirthdayPushForToday — com mais de uma
// instância do app, a outra ainda cai no banco e perde a disputa lá.
const resolvedToday = new Map<string, string>();

/**
 * "Primeiro acesso do dia" = primeiro heartbeat de presença do dia (ver
 * components/presence-heartbeat.tsx: só dispara com a aba em primeiro plano
 * e a pessoa interagindo, então já é uso de verdade, em qualquer tela — não
 * só o Início). O dia é o de Brasília (brazilDateKey), guardado em
 * OrganizationUser.birthdayPushDate.
 *
 * Chamar sem `await` (fire-and-forget) com `.catch`, igual recordUserChange
 * em lib/user-activity.ts — push nunca pode atrasar nem derrubar o
 * heartbeat.
 */
export async function sendBirthdayPushOncePerDay(organizationId: string, userId: string): Promise<void> {
  const today = brazilDateKey();
  const cacheKey = `${organizationId}:${userId}`;
  if (resolvedToday.get(cacheKey) === today) return;

  // UPDATE condicional = "reivindica" o dia atomicamente: duas abas (ou duas
  // instâncias) no primeiro heartbeat quase ao mesmo tempo, só uma vê
  // count === 1 e segue pro envio — sem isso, o consultor recebia a
  // notificação duplicada.
  const claimed = await prisma.organizationUser.updateMany({
    where: {
      organizationId,
      userId,
      OR: [{ birthdayPushDate: null }, { birthdayPushDate: { not: today } }],
    },
    data: { birthdayPushDate: today },
  });
  resolvedToday.set(cacheKey, today);
  if (claimed.count === 0) return;

  const birthdays = await getContactBirthdays(organizationId, userId, 1);
  if (birthdays.length === 0) return;

  const first = birthdays[0];
  const title = birthdays.length === 1 ? "Aniversário de cliente hoje" : `${birthdays.length} clientes fazem aniversário hoje`;
  const body =
    birthdays.length === 1
      ? `${first.name}${first.turningAge ? ` faz ${first.turningAge} anos` : " faz aniversário"} — que tal mandar uma mensagem?`
      : `${birthdays
          .slice(0, 3)
          .map((b) => b.name)
          .join(", ")}${birthdays.length > 3 ? ` e mais ${birthdays.length - 3}` : ""}`;

  await sendPushToUser(userId, { title, body, url: "/" });
}
