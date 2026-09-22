import { PageLoadingSkeleton } from "@/components/page-loading-skeleton";

/**
 * Convenção de arquivo do Next.js (App Router): este arquivo vira o
 * `fallback` de um Suspense colocado automaticamente ao redor de TODA
 * página dentro de configuracoes/* — cobre perfil, pipeline, usuários,
 * motivos de perda, origens, tipos de crédito, cargos, campos
 * personalizados, processos, TV, integrações e auditoria de uma vez só,
 * sem precisar de um arquivo por tela.
 *
 * Por quê isso existe: nenhuma rota do dashboard tinha `loading.tsx` — toda
 * página aqui é `dynamic = "force-dynamic"` (busca dado fresco no servidor
 * a cada acesso, de propósito, ver comentário em next.config.ts sobre
 * staleTimes), então sem esse arquivo o clique ficava "morto" (nada muda na
 * tela) até a página de destino chegar pronta do servidor — mesmo um
 * segundo de espera lê como travado, porque não existe NENHUM feedback
 * entre o clique e o conteúdo aparecer. Com este arquivo, o Next troca a
 * tela por este esqueleto no instante do clique (é só um Suspense boundary,
 * não depende de nenhuma consulta) — a espera de verdade continua a mesma,
 * mas passa a ser visível, o que é a diferença entre "travou" e "carregando".
 *
 * Mesmo esqueleto usado no resto do dashboard agora (ver
 * app/(dashboard)/loading.tsx) — extraído pra components/
 * page-loading-skeleton.tsx.
 */
export default function ConfiguracoesLoading() {
  return <PageLoadingSkeleton />;
}
