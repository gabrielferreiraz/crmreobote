import type { LanguageProfile } from "./types";
import { foldAccents } from "./number-normalizer";

/**
 * Vírgula ANTES de um conectivo/marcador de discurso que aparece no MEIO de
 * um único segmento já reconhecido — diferente de sentence-boundary-
 * detector.ts, que só cobre o caso de a PAUSA cair exatamente no início do
 * conectivo (segmento novo começando com "mas"/"então"...). Aqui a pessoa
 * fala tudo de uma vez, sem pausa nenhuma: "vou fazer por exemplo uma
 * proposta menor" — mesmo sem pausa, a vírgula antes de "por exemplo" é
 * esperada. Roda ANTES do texto entrar no pipeline de fronteira de frase
 * (ver pipeline.ts), sobre o segmento normalizado isolado — nunca sobre o
 * texto já confirmado (isso evitaria reprocessar frases antigas assentadas
 * a cada segmento novo).
 *
 * Só insere vírgula ANTES do marcador (nunca depois) — de propósito: saber
 * onde o parentético "termina" pra fechar com uma 2ª vírgula exigiria achar
 * o fim da oração intercalada, que é ambíguo sem mais contexto sintático.
 * Uma vírgula só (antes) já é gramaticalmente aceitável e resolve a maior
 * parte do ganho sem esse risco.
 */
export function insertMidSentenceCommas(segment: string, profile: LanguageProfile): string {
  if (!segment.trim()) return segment;

  // sentenceConnectors (mas/então/portanto...) reaproveitados aqui pro caso
  // de aparecerem NO MEIO do segmento — o caso de aparecerem no INÍCIO já é
  // tratado por sentence-boundary-detector.ts com sua própria lógica de
  // reabertura, então aqui a checagem começa da 2ª palavra em diante.
  const markers = [...profile.sentenceConnectors.map((c) => c.word), ...profile.midSentenceCommaMarkers];
  // Mais longo primeiro — "por exemplo" não pode perder pra um prefixo mais
  // curto que por acaso também esteja na lista (não há caso hoje, mas é
  // barato garantir e evita surpresa se a lista crescer).
  const sorted = [...markers].sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length);

  const tokens = segment.split(/(\s+)/); // preserva os espaços como tokens intercalados pra reconstrução exata
  const wordTokenIndices = tokens.map((t, i) => (t.trim() ? i : -1)).filter((i) => i >= 0);

  const alreadyMarkedForComma = new Set<number>(); // índice em `tokens` do 1º token da ocorrência já tratada
  for (const marker of sorted) {
    const markerWords = marker.split(/\s+/);
    for (let w = 1; w <= wordTokenIndices.length - markerWords.length; w++) {
      const startTokenIndex = wordTokenIndices[w];
      let matches = true;
      for (let j = 0; j < markerWords.length; j++) {
        const tokenIndex = wordTokenIndices[w + j];
        if (tokenIndex === undefined || foldAccents(tokens[tokenIndex]) !== markerWords[j]) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;
      // Não insere se a palavra ANTERIOR ao marcador já termina em vírgula/
      // pontuação (evita ",," ou vírgula redundante — ex.: reconhecimento
      // já trouxe vírgula ali, ou outro marcador vizinho já tratou o mesmo
      // espaço).
      const precedingWordToken = tokens[startTokenIndex - 2]; // token de PALAVRA anterior (startTokenIndex-1 é o espaço)
      if (precedingWordToken !== undefined && /[,;:.!?…]\s*$/.test(precedingWordToken)) continue;
      // Marca o token de ESPAÇO logo antes do marcador (startTokenIndex-1),
      // não a palavra em si — prependar "," nele preserva o espaçamento
      // original intacto ("fazer" + "," + " " + "por" = "fazer, por").
      alreadyMarkedForComma.add(startTokenIndex - 1);
    }
  }

  if (alreadyMarkedForComma.size === 0) return segment;

  return tokens.map((t, i) => (alreadyMarkedForComma.has(i) ? `,${t}` : t)).join("");
}
