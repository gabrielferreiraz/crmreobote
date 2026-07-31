/**
 * Junta um trecho novo ditado com o que já existia no campo — capitaliza a
 * primeira letra do trecho novo e garante um ponto final antes de emendar.
 * Sem isso, duas frases ditadas em momentos diferentes (ex.: nota de negócio
 * complementada depois) viram uma corrida só sem pontuação nem maiúscula —
 * o Web Speech API nunca devolve isso sozinho, sempre em minúsculo e sem
 * pontuação final. Usado pelos lugares que consomem VoiceInputButton em vez
 * de cada um reimplementar a mesma concatenação.
 *
 * Vive fora de components/voice-input-button.tsx de propósito: é a única
 * peça de lá que a página do negócio precisa importar de forma estática
 * (pro `onResult` callback) — se importasse do arquivo do botão, traria o
 * componente inteiro (Web Speech API + visualização de volume via
 * getUserMedia/AnalyserNode) pro bundle mesmo com o botão carregado via
 * next/dynamic.
 */
export function appendDictatedText(prev: string, text: string): string {
  const trimmedNew = text.trim();
  if (!trimmedNew) return prev;
  const capitalized = trimmedNew.charAt(0).toUpperCase() + trimmedNew.slice(1);
  const trimmedPrev = prev.trim();
  if (!trimmedPrev) return capitalized;
  const needsPunctuation = !/[.!?…]$/.test(trimmedPrev);
  return `${trimmedPrev}${needsPunctuation ? "." : ""} ${capitalized}`;
}
