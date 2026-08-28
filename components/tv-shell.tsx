import type { ReactNode } from "react";

/**
 * Moldura visual da tela de kiosk da TV — extraída de app/tv/layout.tsx pra
 * poder ser reaproveitada também por app/t/[code]/page.tsx (o link público
 * curto, ver lib/tv-display-link.ts), que fica FORA do segmento /tv/* de
 * propósito (rota o mais curta possível pra digitar no controle remoto —
 * "/t/CÓDIGO" em vez de "/tv/p/CÓDIGO"), então não herda app/tv/layout.tsx
 * automaticamente. Sempre escura — não segue o toggle claro/escuro do resto
 * do app (não tem usuário ali pra alternar, é uma tela ligada na parede).
 */
export function TvShell({ children }: { children: ReactNode }) {
  return (
    <div className="tv-gradient-bg dark relative h-screen w-screen overflow-hidden text-white">
      {/* Moldura de segurança contra overscan (ver --tv-safe-margin em
          globals.css) — fica NESTE wrapper interno, não no fundo (acima),
          de propósito: o gradiente de fundo precisa continuar cobrindo a
          tela inteira (se o painel da TV cortar uma faixa da borda, quem
          sobra visível ali ainda é fundo, nunca uma tarja preta/vazia
          diferente do resto). Só o CONTEÚDO (children) fica recuado pra
          dentro da área segura. */}
      <div className="absolute inset-0" style={{ padding: "var(--tv-safe-margin)" }}>
        {children}
      </div>
    </div>
  );
}
