/**
 * Chaves de localStorage compartilhadas pelos filtros de Relatórios —
 * diferente das outras telas (Clientes, Pipeline, Processos, que guardam
 * estado 100% no cliente), aqui o filtro mora na URL (?pipelineId=&who=&from=&to=,
 * lido pelo Server Component em page.tsx). O localStorage aqui só serve pra
 * restaurar a URL quando falta algum desses parâmetros (ver
 * filters-url-restore.tsx) — a fonte da verdade continua sendo a URL.
 */
export const PIPELINE_FILTER_KEY = "crm:filters:relatorios:pipelineId";
export const WHO_FILTER_KEY = "crm:filters:relatorios:who";
export const DATE_RANGE_FILTER_KEY = "crm:filters:relatorios:daterange";
