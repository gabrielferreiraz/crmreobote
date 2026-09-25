/**
 * Data de nascimento do CLIENTE (Contact.birthDate, ver prisma/schema.prisma)
 * — dado civil puro (@db.Date, sem hora/fuso), mesma ideia de User.birthDate,
 * só que agora também no cadastro de cliente. Pedido explícito do usuário:
 * "a gente não consegue colocar, vamos fazer com que seja mais fácil de
 * preencher" — o <input type="date"> nativo que a tela usaria por padrão é
 * notoriamente ruim pra digitar um ano antigo (o calendário abre no mês
 * atual; chegar em, digamos, 1975 exige clicar "mês anterior" décadas de
 * vezes, a menos que a pessoa já saiba que dá pra clicar no rótulo do ano
 * pra pular direto — não óbvio). Por isso a UI (ver components/birth-date-input.tsx)
 * usa um campo de texto com máscara DD/MM/AAAA "ao vivo" em vez do seletor
 * nativo — digitar 8 dígitos seguidos já basta, sem abrir calendário nenhum.
 *
 * Fronteira com a API sempre em "YYYY-MM-DD" (mesmo formato que
 * app/api/org/members/[userId]/route.ts já usa pro birthDate do User) — só a
 * exibição/digitação na tela é DD/MM/AAAA.
 */

/** Máscara "ao vivo" DD/MM/AAAA enquanto a pessoa digita — só dígitos, no máximo 8 (2+2+4). */
export function formatBirthDateMask(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/**
 * Valida dia/mês/ano de verdade, não só o formato — rejeita "31/02/2000"
 * (fevereiro não tem 31 dias), ano fora de uma faixa plausível, ou qualquer
 * data no futuro (ninguém nasce amanhã).
 */
function calendarDateProblem(day: number, month: number, year: number): "nonexistent" | "year" | "future" | null {
  if (month < 1 || month > 12) return "nonexistent";
  const currentYear = new Date().getFullYear();
  // Faixa generosa (não um "maior de 18" ou algo assim, essa tela não tem
  // essa regra de negócio) — só descarta erro de digitação óbvio como
  // "02/02/0002" ou um ano ainda não chegado.
  if (year < 1900 || year > currentYear) return "year";
  // new Date(year, month, 0) = dia 0 do mês seguinte = último dia do mês
  // pedido, truque padrão pra descobrir quantos dias um mês/ano tem
  // (cobre ano bissexto sozinho, sem tabela hardcoded de dias por mês).
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) return "nonexistent";
  // Comparação em UTC (não local) pra nunca depender do fuso de quem está
  // com o navegador aberto — mesma cautela de lib/timezone.ts.
  const candidateUTC = Date.UTC(year, month - 1, day);
  const today = new Date();
  const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return candidateUTC <= todayUTC ? null : "future";
}

function isValidCalendarDate(day: number, month: number, year: number): boolean {
  return calendarDateProblem(day, month, year) === null;
}

/**
 * "DD/MM/AAAA" digitado (com máscara já aplicada) → "YYYY-MM-DD" (formato
 * que a API espera). `null` quando o campo está vazio (opcional, não é
 * erro) OU incompleto/inválido — quem chama decide como distinguir os dois
 * casos (ver isBirthDateInputComplete abaixo, usado só pra mensagem de erro).
 */
export function parseBirthDateInput(masked: string): string | null {
  const m = masked.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  if (!isValidCalendarDate(Number(dd), Number(mm), Number(yyyy))) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Mensagem certa pro que está errado no "DD/MM/AAAA" digitado, ou null se está
 * vazio (opcional) ou válido. Antes TODO caso virava "Data inválida. Use o
 * formato DD/MM/AAAA." — inclusive "31/02/2020", que TEM o formato certo e o
 * problema é a data não existir (achado B5 do relatório de QA). Distingue:
 * incompleto (formato), inexistente (dia/mês), ano fora da faixa e futuro.
 */
export function birthDateInputError(masked: string): string | null {
  const text = masked.trim();
  if (!text) return null;
  const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "Data incompleta. Use o formato DD/MM/AAAA.";
  const problem = calendarDateProblem(Number(m[1]), Number(m[2]), Number(m[3]));
  if (problem === "nonexistent") return "Data inexistente — confira o dia e o mês.";
  if (problem === "year") return `Ano inválido — use um ano entre 1900 e ${new Date().getFullYear()}.`;
  if (problem === "future") return "A data de nascimento não pode estar no futuro.";
  return null;
}

/** "YYYY-MM-DD" (prefixo de qualquer ISO, cobre o que vem de JSON.stringify(Date) também) ou Date → "DD/MM/AAAA" pra pré-preencher o campo mascarado na edição. */
export function isoToBirthDateMask(value: string | Date | null | undefined): string {
  if (!value) return "";
  const iso = typeof value === "string" ? value : value.toISOString();
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const [, yyyy, mm, dd] = m;
  return `${dd}/${mm}/${yyyy}`;
}

/** Mesmo formato compacto "DD/MM" (sem ano) usado pro aniversário do consultor em members-table.tsx — pra mostrar sob o nome/e-mail do cliente sem competir com o resto da tela. */
export function formatBirthDateShort(value: string | Date | null | undefined): string | null {
  const masked = isoToBirthDateMask(value);
  return masked ? masked.slice(0, 5) : null;
}

/**
 * Validação SERVER-SIDE do "YYYY-MM-DD" que a API recebe (já convertido do
 * DD/MM/AAAA digitado, ver parseBirthDateInput) — nunca confia só na
 * validação do cliente, mesma cautela de isValidPhoneInput em
 * lib/phone-normalize.ts. Mesmo formato/checagem que
 * app/api/org/members/[userId]/route.ts já usa pro birthDate do User.
 */
export function isValidBirthDateIso(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}
