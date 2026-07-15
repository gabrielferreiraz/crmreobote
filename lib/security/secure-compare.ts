import { timingSafeEqual } from "crypto";

/**
 * Compara dois segredos em tempo constante — usado onde hoje se comparava
 * string com `===` (segredo de webhook, CRON_SECRET), o que em teoria
 * permite um atacante inferir o segredo caractere a caractere medindo o
 * tempo de resposta. `timingSafeEqual` exige buffers do MESMO tamanho (ele
 * mesmo lança se não forem); como o valor "fornecido" pode ter qualquer
 * tamanho (vem de fora), sempre compara contra um buffer do tamanho do
 * fornecido primeiro — só then confirma que os tamanhos batem com o
 * esperado, sem vazar tempo proporcional ao tamanho certo.
 */
export function secureEqual(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  if (providedBuf.length !== expectedBuf.length) {
    // Ainda roda uma comparação de tamanho igual (contra si mesmo) pra não
    // retornar imediatamente com um tempo bem menor que o caminho "igual".
    timingSafeEqual(providedBuf, providedBuf);
    return false;
  }

  return timingSafeEqual(providedBuf, expectedBuf);
}
