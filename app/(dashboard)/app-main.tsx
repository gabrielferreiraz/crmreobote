"use client";

import { usePathname } from "next/navigation";

/**
 * Telas que já implementam a própria rolagem interna completa, de ponta a
 * ponta (cada painel — lista, kanban, chat — com seu próprio scroll, numa
 * altura travada em h-full/min-h-0 até aqui em cima). Pra essas, deixar o
 * <main> tentar rolar TAMBÉM é redundante na melhor das hipóteses — e na
 * pior, com tantas camadas de flexbox empilhadas (layout > sub-nav > página
 * > painel > lista), sobra sempre um resto de poucos pixels de
 * arredondamento entre uma camada e outra que É overflow de verdade, e isso
 * já bastava pra <main> ativar sua própria barra e a "página inteira" se
 * mexer por cima do que devia ser um app de tela fixa (ver conversa que
 * motivou isso, na tela de WhatsApp → Conversas).
 *
 * Correndo atrás de qual exata camada estava com aquele resto de pixel a
 * mais era caça alta e frágil (qualquer ajuste futuro de padding/gap podia
 * reintroduzir o mesmo sintoma); mais robusto é <main> simplesmente nunca
 * rolar nessas rotas — o filho h-full já preenche o espaço certo sozinho, e
 * qualquer resto de arredondamento vira `overflow-hidden` (invisível) em vez
 * de virar uma barra de rolagem visível.
 */
// /clientes entrou aqui em 09/2026: a lista de Contatos cresceu (Por página
// até 1000, `PAGE_SIZE_OPTIONS` em contacts-table.tsx) e a rolagem passou a
// ser da PÁGINA inteira, não da tabela — selecionar tudo, rolar a lista
// inteira até achar "Próxima página" lá embaixo, trocar de página e ter que
// rolar de volta pro topo pra achar "Selecionar todos" de novo (relatado
// pelo usuário). Mesmo tratamento que o Pipeline já tinha: cabeçalho da
// tabela fica sticky e a paginação vira rodapé fixo (ver contacts-table.tsx),
// os dois sempre à vista, sem depender do tamanho da lista.
const APP_SHELL_ROUTES = ["/whatsapp/conversas", "/processos", "/pipeline", "/clientes"];

// Pipeline é um quadro Kanban de colunas de largura fixa que rolam na
// horizontal — o teto de 1500px (bom pra texto/formulário não esticar
// demais) só cortava colunas inteiras pra dentro do scroll horizontal à toa
// em monitor largo, sobrando uma faixa vazia enorme do lado. Sem teto aqui,
// a fileira de colunas usa a largura de verdade disponível (px-4 lg:px-8 no
// <main>, abaixo, já dá a moldura responsiva das bordas). Conversas/Processos
// não pediram isso ainda — Conversas já gerencia a própria largura via
// painéis redimensionáveis, então ficam de fora por ora.
const FULL_WIDTH_ROUTES = ["/pipeline"];

export function AppMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAppShell = APP_SHELL_ROUTES.some((route) => pathname === route);
  const isFullWidth = FULL_WIDTH_ROUTES.some((route) => pathname === route);
  const hasFlushMobileStickyHeader = pathname.startsWith("/negocios/");

  return (
    <main
      className={`min-h-0 flex-1 overflow-x-hidden px-4 lg:px-8 lg:pt-8 ${
        hasFlushMobileStickyHeader ? "pt-0" : "pt-4"
      } ${
        isAppShell
          ? // Sem overflow-y-auto NEM scrollbar-gutter aqui — não tem scroll
            // nenhum pra reservar espaço, então reservar só criava uma faixa
            // vazia do lado (ver mesma conversa) sem nunca ter conteúdo pra
            // rolar de verdade.
            //
            // O menu mobile agora participa do fluxo do shell. Este padding
            // é apenas a moldura visual do painel, não uma compensação pela
            // navegação inferior.
            "overflow-y-hidden pb-4 lg:pb-6"
          : // scrollbar-gutter reserva o espaço da barra de rolagem o tempo
            // todo — sem isso, trocar o filtro de período no Relatórios (ou
            // qualquer outra navegação que mude a altura do conteúdo) faz a
            // barra aparecer/sumir e o conteúdo inteiro "pular" alguns
            // pixels pro lado.
            //
            // No mobile basta um respiro curto porque a navegação já ocupa
            // espaço real. O desktop mantém a folga maior das páginas longas.
            "overflow-y-auto pb-6 [scrollbar-gutter:stable] lg:pb-24"
      }`}
    >
      <div
        className={`mx-auto w-full ${isAppShell ? "h-full min-h-0" : "min-h-full"} ${
          isFullWidth ? "" : "max-w-[1500px]"
        }`}
      >
        {children}
      </div>
    </main>
  );
}
