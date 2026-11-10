/**
 * Compara "antes" e "depois" de um registro e devolve só o que mudou, já em texto
 * pronto para a tela de auditoria (rótulo em português, valor antes → depois).
 * Módulo PURO (sem banco, sem servidor): roda em qualquer lugar e é testado à parte.
 *
 * Dados sensíveis (CPF, conta bancária...) entram mascarados: a auditoria prova
 * QUE o dado mudou, quando e por quem, sem virar uma segunda cópia do dado.
 */

export type AuditChange = {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
};

export type FieldSpec = {
  label: string;
  /** Converte o valor cru para o texto exibido (ex.: R$ 4.000,00). Sem isto, usa o texto como está. */
  format?: (value: unknown) => string | null;
  /** Mascara o valor (CPF, agência, conta): aparece só o final. */
  sensitive?: boolean;
};

export const MAX_CHANGES_PER_EVENT = 40;
const MAX_VALUE_LENGTH = 240;

/** Vazio, nulo e só espaços são a mesma coisa: "sem valor". */
export function normalizeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  const text = String(value).trim();
  return text === "" ? null : text;
}

/** Mostra só o final: "012.545.659-06" -> "••••••••••••-06". */
export function maskTail(value: string | null, keep = 2): string | null {
  if (value === null) return null;
  if (value.length <= keep) return "••••";
  return "•".repeat(Math.min(12, value.length - keep)) + value.slice(-keep);
}

function clip(value: string | null): string | null {
  if (value === null) return null;
  return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
}

function present(raw: unknown, spec: FieldSpec): string | null {
  const text = spec.format ? spec.format(raw) : normalizeValue(raw);
  const clean = text === undefined ? null : text;
  return clip(spec.sensitive ? maskTail(clean) : clean);
}

/**
 * Só compara os campos que vieram em `after` (atualização parcial não "apaga"
 * campo que nem foi enviado) e que têm especificação.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  specs: Record<string, FieldSpec>,
): AuditChange[] {
  const changes: AuditChange[] = [];
  for (const [field, spec] of Object.entries(specs)) {
    if (!(field in after) || after[field] === undefined) continue;
    const a = normalizeValue(before[field]);
    const b = normalizeValue(after[field]);
    if (a === b) continue;
    changes.push({ field, label: spec.label, from: present(before[field], spec), to: present(after[field], spec) });
    if (changes.length >= MAX_CHANGES_PER_EVENT) break;
  }
  return changes;
}

/** Resumo de uma linha para o campo "detalhe" (e para a busca de texto): "Cidade: A → B; Renda: R$ 1 → R$ 2". */
export function summarizeChanges(changes: AuditChange[], max = 4): string {
  if (changes.length === 0) return "";
  const shown = changes.slice(0, max).map((c) => `${c.label}: ${c.from ?? "vazio"} → ${c.to ?? "vazio"}`);
  const rest = changes.length - shown.length;
  return `${shown.join("; ")}${rest > 0 ? ` e mais ${rest}` : ""}`;
}

/** Lê o JSON guardado no banco com tolerância: um registro estranho nunca derruba a tela. */
export function parseChanges(raw: unknown): AuditChange[] {
  if (!Array.isArray(raw)) return [];
  const out: AuditChange[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.field !== "string" || typeof e.label !== "string") continue;
    out.push({
      field: e.field,
      label: e.label,
      from: typeof e.from === "string" ? e.from : null,
      to: typeof e.to === "string" ? e.to : null,
    });
  }
  return out;
}
