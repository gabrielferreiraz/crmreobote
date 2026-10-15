"use client";

/**
 * Script que aplica o tema escuro antes da 1ª pintura (ver app/layout.tsx).
 *
 * No HTML vindo do servidor é um <script> comum — o navegador executa ao ler
 * o <head>, antes de pintar qualquer coisa. Na hidratação normal o React
 * reaproveita esse mesmo elemento (não cria outro).
 *
 * Mas quando o React precisa CRIAR a raiz no cliente (remontagem da raiz:
 * recarga/HMR do dev, ou recuperação de um erro mais acima na árvore), um
 * <script> criado pelo React nunca é executado — e o React 19 avisa no
 * console ("Encountered a script tag while rendering React component"). Ali
 * ele também não faria falta: o tema já foi aplicado no carregamento da
 * página. Por isso, no cliente, vira um bloco de dados (type="text/plain"),
 * que o React não trata como script: nada executa e não há aviso.
 * suppressHydrationWarning cobre a diferença de `type` entre servidor e
 * cliente na hidratação normal (o React não mexe no atributo do DOM).
 */
export function ThemeInitScript({ code }: { code: string }) {
  const isServer = typeof window === "undefined";
  return <script type={isServer ? undefined : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: code }} />;
}
