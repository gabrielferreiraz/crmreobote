import "server-only";

import { parseServopaPanelCredentials, type ServopaPanelCredentials } from "@/lib/servopa-tables/panel-credentials-core";

export type { ServopaPanelCredentials };

/**
 * Acesso da Reobote ao painel de vendas da Servopa. Fica SOMENTE nas variáveis
 * de ambiente do servidor do CRM (`SERVOPA_USER` = CPF/CNPJ, `SERVOPA_PASS`) —
 * nunca no banco, no código nem em log. É entregue ao computador do robô apenas
 * junto com uma coleta reivindicada (ver app/api/servopa-worker/claim), por
 * HTTPS e com `Cache-Control: no-store`; o robô mantém o valor só em memória.
 * Quem instala o robô não digita nem vê essa senha.
 */
export function readServopaPanelCredentials(): ServopaPanelCredentials | null {
  return parseServopaPanelCredentials(process.env);
}

/** Para a tela avisar que falta configurar — nunca devolve o valor. */
export function hasServopaPanelCredentials(): boolean {
  return readServopaPanelCredentials() !== null;
}
