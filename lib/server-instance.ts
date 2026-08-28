import { randomUUID } from "node:crypto";

/**
 * Identidade do PROCESSO Node atual — gerada uma única vez quando este
 * módulo é carregado pela 1ª vez (ou seja, uma vez por início/reinício do
 * container), fica igual pelo resto da vida do processo. Um novo deploy no
 * EasyPanel derruba o container antigo e sobe um novo → processo novo →
 * este valor muda sozinho, sem precisar de nenhuma variável de ambiente
 * gravada no build nem de ler `.next/BUILD_ID` do disco.
 *
 * Usado pela TV (ver lib/tv-dashboard.ts#getTvMetrics, app/tv/tv-view.tsx)
 * pra detectar deploy novo sozinha: a TV compara o valor que recebeu no
 * carregamento inicial com o que vem em cada resposta do polling (a cada
 * 15s) — mudou, é porque o container reiniciou com código novo, e a TV se
 * recarrega sozinha (ver comentário em tv-view.tsx). Antes disso, o único
 * jeito de uma TV pegar um deploy novo era a recarga diária das 4h da
 * manhã (DAILY_RELOAD_HOUR) — deploy feito às 14h só apareceria na tela às
 * 4h do dia seguinte, quase 14h de atraso pra ver o resultado de uma
 * mudança, sem ninguém perceber que precisava dar F5 manual numa tela
 * pendurada na parede.
 *
 * Guardado em globalThis, mesmo padrão de lib/prisma.ts/lib/tenant-context.ts
 * — o Next.js pode empacotar este módulo mais de uma vez em contextos
 * diferentes (Server Component vs Route Handler vs Server Action), cada
 * cópia rodando seu próprio `randomUUID()` na primeira vez que é
 * importada. Sem isso, `getTvMetrics` (chamado a partir de uma cópia) e
 * `/api/tv/build-id` (chamado a partir de outra) podiam devolver dois
 * UUIDs DIFERENTES pro MESMO processo — a TV interpretaria isso como
 * "deploy novo" e recarregaria sozinha sem nenhum deploy ter acontecido de
 * verdade. Com globalThis, não importa quantas cópias do módulo existam,
 * todas leem/escrevem o mesmo valor.
 */
const globalForServerInstance = globalThis as unknown as { tvServerInstanceId?: string };

export const SERVER_INSTANCE_ID = globalForServerInstance.tvServerInstanceId ?? randomUUID();

globalForServerInstance.tvServerInstanceId = SERVER_INSTANCE_ID;
