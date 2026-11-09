/**
 * Formatação do Backup de mensagens — pura (sem servidor): roda no navegador
 * (telas) e no servidor (exportação). Sempre no fuso de Campo Grande: um
 * `toLocaleString` sem fuso mostraria horas diferentes conforme o computador.
 */

const TZ = "America/Campo_Grande";

const DAY = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const TIME = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const DAY_LONG = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const DAY_SHORT = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" });

/** "09/11/2026" */
export function formatDay(date: Date | string): string {
  return DAY.format(new Date(date));
}

/** "14:35" */
export function formatTime(date: Date | string): string {
  return TIME.format(new Date(date));
}

/** "09 de nov. de 2026" */
export function formatDayShort(date: Date | string): string {
  return DAY_SHORT.format(new Date(date));
}

/** Chave estável do dia (AAAA-MM-DD) no fuso de Campo Grande — agrupa as mensagens por dia. */
export function dayKey(date: Date | string): string {
  const [d, m, y] = DAY.format(new Date(date)).split("/");
  return `${y}-${m}-${d}`;
}

/** Rótulo do separador de dia: "Hoje", "Ontem" ou "segunda-feira, 9 de novembro de 2026". */
export function dayLabel(date: Date | string, now: Date = new Date()): string {
  const key = dayKey(date);
  if (key === dayKey(now)) return "Hoje";
  if (key === dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))) return "Ontem";
  const text = DAY_LONG.format(new Date(date));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "agora", "há 3 h", "há 5 dias", "há 2 meses" — para o "último registro". */
export function timeAgo(date: Date | string, now: Date = new Date()): string {
  const diff = Math.max(0, now.getTime() - new Date(date).getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `há ${days} ${days === 1 ? "dia" : "dias"}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `há ${months} ${months === 1 ? "mês" : "meses"}`;
  const years = Math.floor(days / 365);
  return `há ${years} ${years === 1 ? "ano" : "anos"}`;
}

/** "nov. de 2025 a nov. de 2026" ou "09 de nov. de 2026" quando é um dia só. */
export function formatPeriod(first: Date | string | null, last: Date | string | null): string {
  if (!first || !last) return "—";
  const a = formatDayShort(first);
  const b = formatDayShort(last);
  return a === b ? a : `${a} a ${b}`;
}

/** Número com separador de milhar: 12.345 */
export function formatCount(n: number): string {
  return n.toLocaleString("pt-BR");
}

export const MESSAGE_TYPE_LABEL: Record<string, string> = {
  TEXT: "Texto",
  IMAGE: "Imagem",
  VIDEO: "Vídeo",
  AUDIO: "Áudio",
  CONTACT: "Contato",
  PIX: "Pix",
  BUTTONS: "Botões",
  LIST: "Lista",
  STICKER: "Figurinha",
  CALL: "Chamada",
};

type MessageMeta = { amount?: number; key?: string; name?: string; phone?: string } | null | undefined;

/**
 * O que a mensagem "diz" em texto puro, para o arquivo exportado. Mídia não vai
 * dentro do arquivo (links de mídia expiram): fica o aviso do tipo + a legenda.
 */
export function exportMessageText(type: string, body: string | null, metadata: MessageMeta): string {
  const text = (body ?? "").trim();
  switch (type) {
    case "TEXT":
      return text;
    case "IMAGE":
    case "VIDEO":
    case "AUDIO":
    case "STICKER":
    case "CALL":
    case "BUTTONS":
    case "LIST": {
      const tag = `[${MESSAGE_TYPE_LABEL[type]}]`;
      return text ? `${tag} ${text}` : tag;
    }
    case "CONTACT": {
      const who = [metadata?.name, metadata?.phone].filter(Boolean).join(" · ");
      return who ? `[Contato] ${who}` : "[Contato]";
    }
    case "PIX": {
      const value = metadata?.amount != null ? ` R$ ${metadata.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "";
      return `[Cobrança Pix${value}]${metadata?.key ? ` chave: ${metadata.key}` : ""}`;
    }
    default:
      return text;
  }
}

/** Nome de arquivo seguro: sem acento, sem símbolos, com hífens. */
export function safeFileName(input: string, fallback = "backup"): string {
  const cleaned = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w -]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  return cleaned.slice(0, 60) || fallback;
}
