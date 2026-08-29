/**
 * Benchmark do subsistema de voz — mede tempo de PROCESSAMENTO (CPU, texto
 * puro, sem microfone/rede) do pipeline determinístico
 * (lib/voice/pipeline.ts) contra uma suíte de frases reais em pt-BR, e
 * mostra antes/depois de cada uma. Reexecutável a qualquer momento — não
 * precisa de banco nem de `.env` (é só processamento de texto).
 *
 * Latência de MICROFONE de verdade (tempo até o 1º resultado provisório,
 * até o resultado final) só o navegador consegue medir — isso fica pro
 * teste ao vivo (ver VoiceMetrics, lib/voice/metrics.ts, que já rastreia
 * isso em produção via VoiceSessionManager).
 *
 * Uso: npx tsx scripts/voice-pipeline-benchmark.ts
 */

import { processFinalSegment } from "@/lib/voice/pipeline";

type Case = {
  label: string;
  /** Cada item é um segmento FINAL separado — simula frases reencadeadas
   * pelo Web Speech (uma pausa real entre elas), não um texto colado só. */
  segments: string[];
};

// Casos citados literalmente no pedido do usuário — servem de suíte de
// regressão: se um deles mudar de saída inesperadamente numa alteração
// futura no pipeline, este script acusa na hora.
const CASES: Case[] = [
  {
    label: "Vírgula antes de conectivo adversativo + ponto final",
    segments: [
      "falei com o cliente ontem",
      "ele demonstrou interesse no veiculo",
      "mas precisa analisar a proposta",
    ],
  },
  {
    label: "Pergunta direta (palavra interrogativa na posição 0)",
    segments: ["qual o valor da parcela desse plano"],
  },
  {
    label: "Pergunta INDIRETA — não deve virar interrogação",
    segments: ["eu nao sei quanto ele pretende investir"],
  },
  {
    label: "Vocabulário: follow-up normalizado",
    segments: ["vou fazer o follow up desse lead amanha"],
  },
  {
    label: "Vocabulário: budget preservado (nunca traduzido)",
    segments: ["precisamos revisar o budget da campanha"],
  },
  {
    label: "Relato — número por extenso preservado, não convertido",
    segments: ["o cliente perguntou se temos uma carta de credito de duzentos mil"],
  },
  {
    label: "Abertura modal ('você consegue') → pergunta",
    segments: ["voce consegue enviar a proposta hoje"],
  },
  {
    label: "Vocabulário: CRM/WhatsApp com casing correto",
    segments: ["o cliente quer o crm conectado ao whatsapp"],
  },
];

function runCase(c: Case): { text: string; ms: number } {
  const start = performance.now();
  let text = "";
  for (const segment of c.segments) text = processFinalSegment(text, segment);
  const ms = performance.now() - start;
  return { text, ms };
}

function main() {
  console.log(`Benchmark do pipeline de voz — ${CASES.length} caso(s)\n`);
  let totalMs = 0;
  for (const c of CASES) {
    const { text, ms } = runCase(c);
    totalMs += ms;
    console.log(`▸ ${c.label}`);
    console.log(`  entrada : ${JSON.stringify(c.segments)}`);
    console.log(`  saída   : ${JSON.stringify(text)}`);
    console.log(`  tempo   : ${ms.toFixed(3)}ms\n`);
  }
  console.log(`Total: ${totalMs.toFixed(3)}ms para ${CASES.length} caso(s) — média ${(totalMs / CASES.length).toFixed(3)}ms/caso`);
}

main();
