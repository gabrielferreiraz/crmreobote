/**
 * Comparação PURA de texto de script — sem prisma, usada tanto no servidor
 * (lib/campaigns/script-sync.ts decide se o texto mudou de verdade) quanto no
 * navegador (o editor só pergunta "correção ou nova versão?" quando mudou, e
 * sugere uma resposta pelo tamanho da mudança). Separado de script-sync.ts
 * pelo mesmo motivo de lib/contacts/constants.ts × list-query.ts: importar o
 * arquivo com prisma num componente "use client" arrastaria `pg` pro bundle.
 */

/** Só o que o envio de fato usa (texto sem espaço nas pontas + delay) — chave extra ou ordem de chaves não contam como mudança. */
export function normalizeSteps(steps: unknown): string {
  if (!Array.isArray(steps)) return "[]";
  return JSON.stringify(
    steps.map((s) => {
      const r = (s ?? {}) as { text?: unknown; delayAfterSec?: unknown; type?: unknown; mediaUrl?: unknown };
      return {
        text: typeof r.text === "string" ? r.text.trim() : "",
        delayAfterSec: Number(r.delayAfterSec) || 0,
        type: r.type === "IMAGE" ? "IMAGE" : "TEXT",
        mediaUrl: r.type === "IMAGE" && typeof r.mediaUrl === "string" ? r.mediaUrl : "",
      };
    }),
  );
}

function joinedText(steps: unknown): string {
  if (!Array.isArray(steps)) return "";
  return steps.map((s) => (typeof (s as { text?: unknown })?.text === "string" ? (s as { text: string }).text.trim() : "")).join("\n");
}

/**
 * Quanto do texto mudou, de 0 (igual) a 1 (nada em comum) — distância de
 * Levenshtein dividida pelo tamanho do maior texto. Só serve pra SUGERIR a
 * resposta padrão do diálogo ("parece correção" x "parece nova abordagem");
 * quem decide é sempre a pessoa que edita.
 */
export function textChangeRatio(before: unknown, after: unknown): number {
  const a = joinedText(before);
  const b = joinedText(after);
  if (a === b) return 0;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  // Duas linhas de DP em vez da matriz inteira — script de WhatsApp é curto,
  // mas não custa nada não alocar n×m.
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[b.length] / longest;
}
