/**
 * Regras das campanhas do PDF (sem banco, sem Next — testadas em
 * scripts/test-servopa-campaigns.ts). Datas são chaves "AAAA-MM-DD" do
 * calendário de Campo Grande (lib/timezone.ts → brazilDateKey) e os dois
 * extremos do período contam: 01/11 a 30/11 vale o dia 30 inteiro.
 */

export type ServopaCampaignSegment = "REAL_ESTATE" | "MOVABLE";
/** Onde a arte é usada: ALL = todas as tabelas; os outros, só naquele segmento. */
export type ServopaCampaignArtSlot = "ALL" | ServopaCampaignSegment;
export const SERVOPA_CAMPAIGN_ART_SLOTS: readonly ServopaCampaignArtSlot[] = ["ALL", "REAL_ESTATE", "MOVABLE"];

export type ServopaCampaignStatus = "ACTIVE" | "SCHEDULED" | "ENDED" | "DISABLED" | "NO_ART";

export type ServopaCampaignWindow = {
  id: string;
  enabled: boolean;
  startsOn: string | null;
  endsOn: string | null;
  artKey: string | null;
  realEstateArtKey: string | null;
  movableArtKey: string | null;
  updatedAt: Date | string;
};

export const SERVOPA_CAMPAIGN_NAME_MAX = 80;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isServopaDateKey(value: string): boolean {
  const match = DATE_KEY.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

/** Coluna DATE do Postgres (o Prisma devolve meia-noite UTC) → "AAAA-MM-DD". */
export function dateKeyFromDb(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** "AAAA-MM-DD" → valor para gravar numa coluna DATE. */
export function dbDateFromKey(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

export function servopaCampaignArtKeyFor(
  campaign: Pick<ServopaCampaignWindow, "artKey" | "realEstateArtKey" | "movableArtKey">,
  segment: ServopaCampaignSegment,
): string | null {
  const specific = segment === "REAL_ESTATE" ? campaign.realEstateArtKey : campaign.movableArtKey;
  return specific ?? campaign.artKey;
}

function hasAnyArt(campaign: ServopaCampaignWindow) {
  return !!(campaign.artKey || campaign.realEstateArtKey || campaign.movableArtKey);
}

export function servopaCampaignStatus(campaign: ServopaCampaignWindow, today: string): ServopaCampaignStatus {
  if (!campaign.enabled) return "DISABLED";
  if (!hasAnyArt(campaign)) return "NO_ART";
  if (campaign.endsOn && campaign.endsOn < today) return "ENDED";
  if (campaign.startsOn && campaign.startsOn > today) return "SCHEDULED";
  return "ACTIVE";
}

/**
 * Campanha que vale hoje (opcionalmente para um segmento — precisa ter arte
 * para ele). Se várias valem ao mesmo tempo, vence a que começou por último
 * (sem início = a mais antiga) e, empatando, a editada por último: quem cadastra
 * uma campanha curta dentro de outra longa espera que a curta apareça.
 */
export function pickActiveServopaCampaign<T extends ServopaCampaignWindow>(
  campaigns: readonly T[],
  today: string,
  segment?: ServopaCampaignSegment,
): T | null {
  const candidates = campaigns.filter((campaign) =>
    servopaCampaignStatus(campaign, today) === "ACTIVE" && (!segment || servopaCampaignArtKeyFor(campaign, segment)),
  );
  candidates.sort((a, b) => {
    const start = (b.startsOn ?? "").localeCompare(a.startsOn ?? "");
    if (start !== 0) return start;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  return candidates[0] ?? null;
}

// ─── Ajudas da tela de cadastro ─────────────────────────────────────────────

function keyToUtc(key: string) {
  return Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
}

function utcToKey(time: number) {
  return new Date(time).toISOString().slice(0, 10);
}

function brDay(key: string) {
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}

/** Mês inteiro a partir de hoje: 0 = este mês, 1 = o próximo… */
export function servopaMonthRange(today: string, offset: number): { startsOn: string; endsOn: string; label: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1 + offset;
  const first = Date.UTC(year, month, 1);
  const last = Date.UTC(year, month + 1, 0);
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(first);
  return { startsOn: utcToKey(first), endsOn: utcToKey(last), label: label.charAt(0).toUpperCase() + label.slice(1) };
}

function inDays(from: string, to: string) {
  const days = Math.round((keyToUtc(to) - keyToUtc(from)) / 86_400_000);
  return days === 1 ? "amanhã" : `daqui a ${days} dias`;
}

/** Frase da tela: quando a faixa aparece nos PDFs (sem contar se está ligada ou tem arte). */
export function describeServopaCampaignWindow(startsOn: string | null, endsOn: string | null, today: string): string {
  if (endsOn && endsOn < today) return `Já terminou em ${brDay(endsOn)}.`;
  const until = endsOn ? ` até ${brDay(endsOn)}` : " sem data para acabar";
  if (startsOn && startsOn > today) return `Aparece nos PDFs a partir de ${brDay(startsOn)} (${inDays(today, startsOn)})${until}.`;
  return `Aparece nos PDFs desde já${until}.`;
}

/** Campanhas ligadas cujo período cruza o informado (sem data = sem limite daquele lado). */
export function overlappingServopaCampaigns<T extends Pick<ServopaCampaignWindow, "id" | "enabled" | "startsOn" | "endsOn">>(
  campaigns: readonly T[],
  period: { id?: string | null; startsOn: string | null; endsOn: string | null },
): T[] {
  return campaigns.filter((other) =>
    other.id !== period.id
    && other.enabled
    && (!other.endsOn || !period.startsOn || other.endsOn >= period.startsOn)
    && (!period.endsOn || !other.startsOn || period.endsOn >= other.startsOn),
  );
}

/** Endereço da arte na mesma origem do CRM (ver app/api/servopa-tables/campaign-art). */
export function servopaCampaignArtUrl(key: string): string {
  return `/api/servopa-tables/campaign-art/${key}`;
}
