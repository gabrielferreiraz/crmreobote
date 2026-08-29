import { processFinalSegment } from "@/lib/voice/pipeline";

/**
 * Junta um trecho novo ditado (prosa corrida — nota de negócio, título/
 * descrição de tarefa) com o que já existia no campo. Mesma assinatura de
 * sempre — por dentro, delega pro pipeline determinístico do subsistema de
 * voz (lib/voice/pipeline.ts): normaliza vocabulário de CRM/marketing
 * (follow-up, CRM, WhatsApp...), decide vírgula/ponto/interrogação por
 * score (nunca "toda pausa vira pontuação"), preservando o comportamento
 * antigo como piso — nunca fica pior do que "capitaliza e emenda com
 * ponto", só ganha os casos que esse mínimo não cobria.
 *
 * Vive fora de lib/voice/ de propósito (mesmo motivo de antes): é a única
 * peça que a página do negócio/agenda precisa importar de forma estática
 * pro `onResult` callback — importar do subsistema de voz inteiro traria
 * módulos que não fazem sentido pra essas páginas puxarem à toa.
 *
 * `language` é opcional (default pt-BR, igual ao resto do sistema hoje) —
 * mas ACEITA e REPASSA pra processFinalSegment em vez de ignorar: esta
 * função é chamada como `SegmentProcessor` (ver lib/voice/transcript-
 * engine.ts) por lib/use-voice-transcription.ts, que sempre invoca com 3
 * argumentos (`prev, raw, language`) — sem este parâmetro aqui, o idioma da
 * sessão (ex.: se algum dia um campo passar `useVoiceTranscription(...,
 * "en-US")`) seria silenciosamente descartado e a prosa sempre pontuada com
 * regras de pt-BR, mesmo com a fala reconhecida em outro idioma.
 */
export function appendDictatedText(prev: string, text: string, language?: string): string {
  return processFinalSegment(prev, text, language);
}
