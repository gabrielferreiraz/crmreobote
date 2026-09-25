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
 * Duas fontes, porque o dado vive em dois lugares (medido em produção
 * 09/2026: 8 clientes no campo novo, 14.670 no antigo):
 * 1. Contact.birthDate — campo nativo (ver components/birth-date-input.tsx).
 * 2. Campo personalizado "Aniversário" (tipo DATE, "YYYY-MM-DD") — onde a
 *    importação do Agendor gravou (ver scripts/agendor/import-pessoas.ts).
 *    Lendo só a fonte 1 o card apareceria vazio pra quase todo mundo.
 * Se o mesmo cliente tem as duas, vale a nativa.
 */

export const BIRTHDAY_FIELD_LABEL = "Aniversário";

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

type BirthdayRow = { id: string; name: string; responsavel: { name: string } | null };

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
  const found = new Map<string, ContactBirthday>();
  const ownerFilter = responsavelId ? { responsavelId } : {};

  const push = (c: BirthdayRow, birthYear: number, birthMonth: number, birthDay: number) => {
    const hit = window.get(`${pad2(birthMonth)}-${pad2(birthDay)}`);
    if (!hit) return;
    found.set(c.id, {
      contactId: c.id,
      name: c.name,
      daysUntil: hit.daysUntil,
      day: hit.day,
      month: hit.month,
      turningAge: plausibleAge(birthYear, hit.year),
      responsavelName: c.responsavel?.name ?? null,
    });
  };

  const [nativeRows, def] = await Promise.all([
    // Só quem TEM data preenchida (e, fora da visão do Dono, só da carteira
    // desta pessoa) — a quantidade cresce só com cadastro manual, então
    // filtrar dia/mês aqui em JS (o Prisma não filtra por parte de uma
    // coluna DATE) é barato.
    prisma.contact.findMany({
      where: { organizationId, ...ownerFilter, birthDate: { not: null } },
      select: { id: true, name: true, birthDate: true, responsavel: { select: { name: true } } },
    }),
    prisma.customFieldDefinition.findFirst({
      where: {
        organizationId,
        entityType: "CONTACT",
        type: "DATE",
        label: { equals: BIRTHDAY_FIELD_LABEL, mode: "insensitive" },
      },
      select: { id: true },
    }),
  ]);

  // Fonte 1 primeiro: se o cliente tem as duas datas, a nativa vence (a
  // fonte 2 abaixo pula quem já está em `found`).
  for (const c of nativeRows) {
    if (!c.birthDate) continue;
    // getUTC*: @db.Date volta como meia-noite UTC, os getters locais podiam
    // ler o dia anterior (mesma armadilha do carrossel da TV, lib/tv-dashboard.ts).
    push(c, c.birthDate.getUTCFullYear(), c.birthDate.getUTCMonth() + 1, c.birthDate.getUTCDate());
  }

  if (def) {
    // Filtra no banco pelos "-MM-DD" da janela (valor é "YYYY-MM-DD") em vez
    // de trazer os milhares de clientes da carteira só pra olhar uma data.
    const rows = await prisma.contact.findMany({
      where: {
        organizationId,
        ...ownerFilter,
        OR: Array.from(window.keys()).map((key) => ({
          customFieldValues: { path: [def.id], string_contains: `-${key}` },
        })),
      },
      select: { id: true, name: true, customFieldValues: true, responsavel: { select: { name: true } } },
    });
    for (const c of rows) {
      if (found.has(c.id)) continue;
      const raw = (c.customFieldValues as Record<string, unknown> | null)?.[def.id];
      const m = typeof raw === "string" ? raw.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
      if (!m) continue;
      push(c, Number(m[1]), Number(m[2]), Number(m[3]));
    }
  }

  return Array.from(found.values()).sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name, "pt-BR"));
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
