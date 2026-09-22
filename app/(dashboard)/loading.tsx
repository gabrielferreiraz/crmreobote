import { PageLoadingSkeleton } from "@/components/page-loading-skeleton";

/**
 * Mesma correção de configuracoes/loading.tsx (ver o comentário completo
 * lá), agora estendida pro RESTO do dashboard — Início, Pipeline, Clientes,
 * Negócios, Relatórios, WhatsApp, Processos, Agenda, Automações. Até aqui só
 * configuracoes/* tinha esse arquivo; toda outra navegação ficava "morta" no
 * clique (nenhum feedback visual) até a página de destino terminar de
 * buscar TODO o próprio dado no servidor — em páginas com várias consultas
 * em paralelo (Relatórios, Pipeline) isso podia passar de 1s parecendo
 * travado, mesmo com as consultas já bem otimizadas.
 *
 * Um arquivo só aqui na raiz de (dashboard) resolve tudo de uma vez: o
 * Next.js usa o `loading.tsx` mais específico pra cada rota, então
 * configuracoes/* continua usando o próprio (mais preciso: já teria voltado
 * exatamente pra Configurações), e qualquer outra rota sem loading.tsx
 * próprio cai neste aqui — sem precisar de um arquivo por pasta.
 *
 * Puramente um Suspense boundary — não depende de nenhuma consulta, não
 * reduz o tempo real de carregamento, só o torna VISÍVEL em vez de "tela
 * travada" (a queixa relatada: "demorado a troca de páginas").
 */
export default function DashboardLoading() {
  return <PageLoadingSkeleton />;
}
