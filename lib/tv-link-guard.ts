/**
 * Proteção contra ADIVINHAÇÃO do código curto do link do Ranking (3
 * caracteres, ver RANKING_CODE_LENGTH em lib/tv-display-link.ts).
 *
 * Por que existe: o código do Ranking tem só 32³ = 32.768 combinações — pedido
 * explícito, porque digitar mais que isso no controle da TV é inviável. Sozinho
 * isso é adivinhável por força bruta, então a defesa deixa de estar na
 * entropia do código e passa a estar em LIMITAR OS CHUTES ERRADOS.
 *
 * O desenho tem que resolver um problema real: a TV e um cliente na rede
 * Wi-Fi do escritório costumam compartilhar o MESMO IP público. Um limite
 * simples "N erros por IP" deixaria o cliente travar a própria TV só chutando
 * códigos. Por isso a regra é por PAR (IP + código):
 * - Par que já FUNCIONOU (a TV de verdade, todo poll de 15s) é "de confiança":
 *   nunca é bloqueado e nunca conta como chute — mesmo depois de o link ser
 *   revogado, senão a TV velha ainda tentando o código antigo gastaria o
 *   orçamento de erros e impediria digitar o código novo.
 * - Qualquer OUTRO par é um chute em potencial e gasta orçamento quando erra:
 *   PER_IP_FAILURES por IP por hora, e GLOBAL_FAILURES no total por hora
 *   (contra quem rotaciona IP falso via cabeçalho x-forwarded-for, que o
 *   limitador por IP sozinho não segura). Estourou o orçamento, o chute é
 *   recusado SEM nem consultar o banco (recusar só os errados seria um oráculo).
 *
 * Conta de cabeça: com 100 erros/hora no total, varrer 32.768 códigos leva
 * ~13 dias no melhor caso pro atacante — e o par que a TV já usa nunca
 * atrapalha nem é atrapalhado.
 *
 * Em memória, por processo (mesma limitação de lib/rate-limit.ts: com várias
 * instâncias o limite efetivo multiplica, e reiniciar o servidor zera). Um
 * restart perde a "confiança" dos pares, mas a TV simplesmente volta a ser um
 * par novo que ainda cabe no orçamento e ganha confiança de novo no 1º poll.
 */

const WINDOW_MS = 60 * 60 * 1000;
const PER_IP_FAILURES = 10;
const GLOBAL_FAILURES = 100;
/** Quanto tempo um par que funcionou continua "de confiança" sem novo sucesso. */
const TRUST_MS = 24 * 60 * 60 * 1000;

type Counter = { count: number; resetAt: number };

const failuresByIp = new Map<string, Counter>();
const trustedPairs = new Map<string, number>();
let globalFailures: Counter = { count: 0, resetAt: 0 };

function currentCount(counter: Counter | undefined, now: number): number {
  return counter && counter.resetAt > now ? counter.count : 0;
}

/** Limpeza oportunista (mesma ideia de lib/rate-limit.ts) — um atacante rotacionando IPs não pode fazer os mapas crescerem sem limite. */
function sweep(now: number) {
  if (Math.random() >= 0.01) return;
  for (const [k, v] of failuresByIp) if (v.resetAt <= now) failuresByIp.delete(k);
  for (const [k, expiresAt] of trustedPairs) if (expiresAt <= now) trustedPairs.delete(k);
}

/** Chave do par: IP + hash do código (nunca o código em si na memória). */
export function shortCodePairKey(ip: string, codeHash: string): string {
  return `${ip}|${codeHash}`;
}

/**
 * Pode tentar este par agora? `trusted` volta junto pra quem chama passar
 * adiante em recordShortCodeAttempt (evita consultar o mapa duas vezes).
 */
export function checkShortCodeAttempt(
  ip: string,
  pairKey: string,
  now: number = Date.now(),
): { allowed: boolean; trusted: boolean } {
  sweep(now);
  const trusted = (trustedPairs.get(pairKey) ?? 0) > now;
  if (trusted) return { allowed: true, trusted: true };
  const blocked =
    currentCount(failuresByIp.get(ip), now) >= PER_IP_FAILURES || currentCount(globalFailures, now) >= GLOBAL_FAILURES;
  return { allowed: !blocked, trusted: false };
}

/** Registra o resultado de uma tentativa que foi de fato ao banco. */
export function recordShortCodeAttempt(
  ip: string,
  pairKey: string,
  ok: boolean,
  trusted: boolean,
  now: number = Date.now(),
): void {
  if (ok) {
    trustedPairs.set(pairKey, now + TRUST_MS);
    return;
  }
  // Par de confiança que agora falha (link revogado): não é chute, não gasta
  // orçamento — ver o comentário do topo.
  if (trusted) return;

  const ipEntry = failuresByIp.get(ip);
  if (!ipEntry || ipEntry.resetAt <= now) failuresByIp.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  else ipEntry.count += 1;

  if (globalFailures.resetAt <= now) globalFailures = { count: 1, resetAt: now + WINDOW_MS };
  else globalFailures.count += 1;
}

/** Só pra teste — zera todo o estado em memória. */
export function resetShortCodeGuard(): void {
  failuresByIp.clear();
  trustedPairs.clear();
  globalFailures = { count: 0, resetAt: 0 };
}
