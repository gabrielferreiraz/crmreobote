/**
 * Detecção central de suporte à Web Speech API — hoje o ÚNICO lugar do
 * subsistema que sabe que `window.SpeechRecognition`/`webkitSpeechRecognition`
 * existem (ver web-speech-engine.ts). Nenhum outro módulo (VoiceSessionManager,
 * TranscriptEngine, hook, UI) toca esses globais diretamente.
 */
export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window.SpeechRecognition ?? window.webkitSpeechRecognition);
}
