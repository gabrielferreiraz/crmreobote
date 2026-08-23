import type { Metadata, Viewport } from "next";
import { DM_Sans, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";

const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    if (theme === "dark") document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

// Redesign (ver new-design-for-claude/README.md) — DM Sans no lugar da Geist
// Sans anterior, pesos 400-700 (a marcação do protótipo usa até 700 em
// título/KPI). Geist_Mono continua igual — nada no redesign pede
// monoespaçada, e o hint "⌘K" do command palette já usa font-mono de propósito.
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CRM",
  description: "CRM para equipes de vendas de consórcio",
  appleWebApp: {
    capable: true,
    title: "CRM",
    statusBarStyle: "black-translucent",
  },
};

// viewport-fit=cover é o que faz `env(safe-area-inset-*)` funcionar de
// verdade nos cantos arredondados/notch do iPhone — sem isso a barra de
// navegação e o FAB do mobile ficam encostados na borda. themeColor pinta a
// barra de status/endereço do navegador com a cor do app em vez do branco
// padrão, tirando aquele "corte" visual entre o app e o resto do celular.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#5a5be6" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${dmSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* SEM <head> escrito à mão — metadata/viewport acima já geram o
            <head> de verdade sozinhas. Colocar o script AQUI dentro (não
            dentro de um <head> nosso) é o próprio exemplo oficial da
            documentação desta versão (node_modules/next/dist/docs/.../
            scripts.md) — um <head> escrito manualmente põe os filhos num
            contexto especial do React (onde só link/meta/title/style são
            tratados como "recurso hoistable"; um script ali é isso que
            disparava "Encountered a script tag..."). strategy=
            "beforeInteractive" garante que o Next ainda insere e executa
            isso no <head> de verdade, cedo o bastante pra nunca haver
            flash de tema errado — a posição no JSX não muda onde ele
            realmente cai no HTML final. */}
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
