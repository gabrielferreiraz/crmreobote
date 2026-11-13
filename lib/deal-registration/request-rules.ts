/**
 * Pedido de documento do administrativo ao consultor (depois do Ganho).
 *
 * Módulo PURO (sem banco): a API valida com ele e a tela usa o mesmo catálogo.
 * Cada pedido tem itens; cada item é atendido sozinho — com o envio do arquivo
 * (itens com `needsFile`) ou com uma resposta escrita (os demais). Todos os
 * itens atendidos = pedido atendido.
 */

export type RequestDocKind = "PHOTO_ID" | "SOCIAL_CONTRACT" | "OTHER" | "PAYMENT_PROOF";

export type RequestItem = {
  key: string;
  label: string;
  /** Tipo do arquivo quando o item pede um envio; null = resposta escrita. */
  kind: RequestDocKind | null;
  needsFile: boolean;
  doneAt: string | null;
  documentIds: string[];
  /** Resposta do consultor (obrigatória nos itens sem arquivo). */
  note: string | null;
};

export type CatalogItem = { key: string; label: string; hint: string; kind: RequestDocKind | null };

/** Atalhos que o administrativo marca com um clique. */
export const REQUEST_CATALOG: CatalogItem[] = [
  { key: "photo_id", label: "Documento com foto (CNH ou RG)", hint: "Frente e verso, legível", kind: "PHOTO_ID" },
  { key: "proof_address", label: "Comprovante de residência", hint: "Dos últimos 90 dias", kind: "OTHER" },
  { key: "proof_income", label: "Comprovante de renda", hint: "Holerite, extrato ou declaração", kind: "OTHER" },
  { key: "marriage", label: "Certidão de casamento", hint: "Quando o cliente é casado(a)", kind: "OTHER" },
  { key: "payment_proof", label: "Comprovante de pagamento (Pix)", hint: "Print ou PDF do comprovante", kind: "PAYMENT_PROOF" },
  { key: "social_contract", label: "Contrato social", hint: "Pessoa jurídica", kind: "SOCIAL_CONTRACT" },
  { key: "other_file", label: "Outro documento", hint: "Descreva qual na mensagem", kind: "OTHER" },
  {
    key: "quota_info",
    label: "Informar grupo, prazo e forma de pagamento",
    hint: "O consultor preenche e o cadastro já é atualizado",
    kind: null,
  },
  { key: "fix_data", label: "Corrigir uma informação", hint: "O consultor responde por escrito", kind: null },
];

export const REQUEST_MAX_ITEMS = 8;
export const REQUEST_MESSAGE_MAX = 600;
export const REQUEST_LABEL_MAX = 80;
export const REQUEST_NOTE_MAX = 400;

export function buildRequestItem(input: { key: string; label?: string }): RequestItem | null {
  const preset = REQUEST_CATALOG.find((c) => c.key === input.key);
  const label = (preset?.label ?? input.label ?? "").trim().slice(0, REQUEST_LABEL_MAX);
  if (!label) return null;
  // Item livre ("custom:...") pede arquivo do tipo "Outro".
  const kind = preset ? preset.kind : "OTHER";
  return { key: input.key, label, kind, needsFile: kind !== null, doneAt: null, documentIds: [], note: null };
}

/** Lê o JSON guardado no banco com tolerância (nunca derruba a tela por um registro estranho). */
export function parseRequestItems(raw: unknown): RequestItem[] {
  if (!Array.isArray(raw)) return [];
  const items: RequestItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.key !== "string" || typeof e.label !== "string") continue;
    const kind = e.kind === "PHOTO_ID" || e.kind === "SOCIAL_CONTRACT" || e.kind === "OTHER" || e.kind === "PAYMENT_PROOF" ? e.kind : null;
    items.push({
      key: e.key,
      label: e.label,
      kind,
      needsFile: typeof e.needsFile === "boolean" ? e.needsFile : kind !== null,
      doneAt: typeof e.doneAt === "string" ? e.doneAt : null,
      documentIds: Array.isArray(e.documentIds) ? e.documentIds.filter((d): d is string => typeof d === "string") : [],
      note: typeof e.note === "string" ? e.note : null,
    });
  }
  return items;
}

export function isRequestComplete(items: RequestItem[]): boolean {
  return items.length > 0 && items.every((i) => i.doneAt);
}

export function countRequestPending(items: RequestItem[]): number {
  return items.filter((i) => !i.doneAt).length;
}

/** "Falta: Comprovante de renda e mais 1" — frase curta para listas e avisos. */
export function summarizeRequestItems(items: RequestItem[], maxLabels = 2): string {
  const labels = items.filter((i) => !i.doneAt).map((i) => i.label);
  if (labels.length === 0) return "";
  const shown = labels.slice(0, maxLabels);
  const rest = labels.length - shown.length;
  return `${shown.join(", ")}${rest > 0 ? ` e mais ${rest}` : ""}`;
}

export const REQUEST_TASK_TITLE_PREFIX = "Enviar documento:";
