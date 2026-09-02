import { ALL_LEAD_LABELS, foldAccents, normalizeLabel, shouldTitleCaseLabelValue, stripEdgeFillers } from "./parse-lead-text";

/**
 * Reformata um trecho recém-DITADO (Web Speech API, ver components/
 * voice-input-button.tsx) pro formato "Rótulo: valor" que parseLeadText
 * entende — o ditado chega como um bloco contínuo, sem quebra de linha
 * nenhuma entre os campos, numa fala natural cheia de pronome/conectivo
 * ("o cliente se chama Gabriel, ele mora em Campo Grande, o telefone dele
 * é..."), bem diferente de texto colado (já quebrado por linha, direto ao
 * ponto). "Regex pesado" de propósito: varre o texto inteiro (não só o
 * início de cada linha, como parseLeadText faz) atrás de QUALQUER
 * ocorrência de um rótulo conhecido, e limpa pronome/conectivo solto nas
 * bordas de cada valor encontrado — sem isso, "ele mora em Campo Grande ele
 * trabalha" virava cidade "Campo Grande Ele" (o pronome do próximo trecho
 * grudado no valor anterior).
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Alguns rótulos de UMA palavra só são específicos demais pro modo "varre o
// texto inteiro" — "cliente", por exemplo, é reconhecido com segurança por
// parseLeadText (só testa o INÍCIO de cada linha, então "cliente" ali só
// dispara se for mesmo a 1ª palavra), mas aqui, escaneando qualquer ponto de
// uma frase natural, a mesma palavra aparece o tempo todo como substantivo
// comum ("o cliente quer...", "para esse cliente...") e fragmentaria o
// texto à toa. Fora do dicionário completo (ALL_LEAD_LABELS) só pra ESTE
// escaneamento — o reconhecimento por linha em parseLeadText continua
// intacto, essas palavras ainda funcionam lá.
//
// "bruto"/"liquido" NÃO entram (mesma lista de AMBIGUOUS_MIDLINE_LABELS em
// parse-lead-text.ts — as duas pontas nunca podem divergir, ver comentário
// lá) — pedido explícito de reconhecer melhor "valor bruto"/"valor líquido"
// ditados, e nenhum dos dois é palavra comum de sobrar solta numa frase de
// cadastro de negócio fora do sentido financeiro.
const DICTATION_SCAN_DENYLIST = new Set(
  ["cliente", "contato", "lead", "tipo", "categoria", "credito", "fixo", "tel", "cel", "n", "num", "compl", "uf", "obs"].map(
    normalizeLabel,
  ),
);
const DICTATION_SCAN_LABELS = ALL_LEAD_LABELS.filter((label) => !DICTATION_SCAN_DENYLIST.has(label));

// Do rótulo mais específico/comprido pro mais genérico (mesma ordem de
// ALL_LEAD_LABELS) — na alternação do regex, a primeira opção que casar
// numa posição vence, então "numero whatsapp" precisa vir antes de "numero"
// sozinho, senão sobra "whatsapp" solto como se fosse valor.
const LABEL_SCAN_PATTERN = DICTATION_SCAN_LABELS.map((label) => label.split(" ").map(escapeRegExp).join("\\s+")).join(
  "|",
);
const LABEL_SCAN_REGEX = new RegExp(`\\b(?:${LABEL_SCAN_PATTERN})\\b`, "g");

// "de", "da", "do"... ficam minúsculos mesmo no meio de um nome/endereço
// capitalizado ("Maria de Souza", não "Maria De Souza") — só a 1ª palavra
// sempre capitaliza, mesmo se ela mesma for um conectivo.
const LOWERCASE_CONNECTORS = new Set(["de", "da", "do", "dos", "das", "e"]);

function titleCase(value: string): string {
  return value
    .split(" ")
    .map((word, i) => {
      if (!word) return word;
      const lower = word.toLowerCase();
      if (i > 0 && LOWERCASE_CONNECTORS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/**
 * "nome gabriel medeiros telefone 67981783902 cidade campo grande ms" →
 * "nome: gabriel medeiros\ntelefone: 67981783902\ncidade: campo grande ms".
 * Texto sem nenhum rótulo reconhecido volta inalterado (vira uma linha comum,
 * igual sempre foi — sem rótulo pra marcar, não tem o que reformatar).
 */
export function formatDictatedLeadText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  // foldAccents preserva o comprimento (1 caractere vira exatamente 1 outro)
  // — os índices batidos aqui recortam certo o texto ORIGINAL (com acento e
  // caixa de verdade) abaixo, mesmo comparando numa versão dobrada.
  const folded = foldAccents(trimmed);
  const matches = [...folded.matchAll(LABEL_SCAN_REGEX)].filter((m) => m.index !== undefined);
  if (matches.length === 0) return trimmed;

  const lines: string[] = [];
  const firstStart = matches[0].index!;
  const preamble = stripEdgeFillers(trimmed.slice(0, firstStart).trim());
  if (preamble) lines.push(preamble);

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const labelStart = m.index!;
    const labelEnd = labelStart + m[0].length;
    const valueEnd = i + 1 < matches.length ? matches[i + 1].index! : trimmed.length;
    const rawLabel = trimmed.slice(labelStart, labelEnd);
    const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
    let value = stripEdgeFillers(trimmed.slice(labelEnd, valueEnd).trim());
    // Ditado por voz sempre chega em minúsculo (a Web Speech API nunca
    // devolve maiúscula sozinha) — capitaliza nome/cidade/empresa/endereço
    // pra não precisar corrigir tudo na mão antes de criar.
    if (value && shouldTitleCaseLabelValue(normalizeLabel(rawLabel))) value = titleCase(value);
    lines.push(value ? `${label}: ${value}` : `${label}:`);
  }

  return lines.join("\n");
}

/**
 * Junta um trecho novo ditado (já reformatado, ver acima) ao que já existia
 * no campo "Colar texto do lead" — sempre em linha nova, nunca emendado na
 * mesma frase (ao contrário de appendDictatedText/lib/dictation.ts, pensado
 * pra nota/título em prosa corrida, não pra uma lista de campos).
 */
export function appendDictatedLeadText(prev: string, text: string): string {
  const formatted = formatDictatedLeadText(text);
  if (!formatted) return prev;
  const trimmedPrev = prev.trim();
  return trimmedPrev ? `${trimmedPrev}\n${formatted}` : formatted;
}
