/**
 * Nome do cookie que lembra o ÚLTIMO funil escolhido no seletor do Pipeline
 * — precisa ser cookie, não localStorage (o resto do app usa
 * usePersistedFilters/localStorage pra filtro, ver lib/use-persisted-filters.ts),
 * porque QUEM decide o funil ativo é o Server Component (app/(dashboard)/
 * pipeline/page.tsx: `activePipeline = pipelines.find(...pipelineIdParam) ?? ...`),
 * pra já buscar os dados certos no primeiro render — localStorage não existe
 * no servidor, só cookie viaja junto com a própria requisição.
 *
 * Sem isso, um link estático de volta pro Pipeline (ex.: "← Pipeline" no
 * detalhe do negócio, ou o item da sidebar) nunca carrega `?pipelineId=`, e
 * a página sempre caía de volta no funil padrão — mesmo que a pessoa tivesse
 * trocado pra outro funil segundos antes. Path "/" (não só "/pipeline") de
 * propósito: mais barato ler de qualquer rota do que restringir o path e
 * arriscar o cookie não ser enviado por engano num caso de borda.
 */
export const PIPELINE_LAST_ID_COOKIE = "crm-pipeline-last-id";
