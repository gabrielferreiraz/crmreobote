"use server";

import { brazilDateKey } from "@/lib/timezone";

/**
 * Retorna a data de hoje no fuso de Campo Grande/MS calculada NO SERVIDOR
 * (America/Campo_Grande, UTC-4). Usado pelo ClosedAtDialog para pré-preencher
 * o campo de data de fechamento com a data real do servidor, em vez de confiar
 * no relógio local do dispositivo do usuário — que pode estar errado e
 * causaria um closedAt gravado num dia diferente do real
 * (bug confirmado em produção: consultora com relógio 1 dia atrasado).
 */
export async function getServerTodayKey(): Promise<string> {
  return brazilDateKey(new Date());
}
