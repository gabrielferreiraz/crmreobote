import { Skeleton } from "@/components/skeleton";

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
 * Esqueleto genérico de propósito (título + algumas linhas em card) — não
 * tenta imitar o layout exato de cada tela de destino (uma é tabela, outra
 * é lista, outra é formulário); o objetivo é só dar retorno visual
 * imediato, não uma prévia pixel-perfect do conteúdo final.
 */
export default function ConfiguracoesLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="card divide-y divide-neutral-100 dark:divide-neutral-800">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-4">
            <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3.5 w-full max-w-72" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
