import type { NextConfig } from "next";

// Headers de segurança. A CSP (Content-Security-Policy) entra em DUAS camadas,
// de propósito (relatório de QA, achado M2 — mas com o cuidado que o comentário
// anterior desta config já pedia: uma CSP errada derruba a aplicação inteira em
// produção — imagens do R2, gravação de áudio do WhatsApp, SDK do Facebook — e
// isso não dá pra validar sem o app rodando):
//
// 1. APLICADA (`Content-Security-Policy`): só as 3 diretivas que este app não
//    usa de jeito nenhum, então não têm como quebrar nada — `object-src 'none'`
//    (não há <object>/<embed>/plugins), `base-uri 'self'` (nenhuma <base>;
//    fecha a injeção de <base href> que sequestra links relativos) e
//    `frame-ancestors 'self'` (o equivalente moderno do X-Frame-Options
//    SAMEORIGIN abaixo, que já existia).
// 2. SÓ RELATA (`Content-Security-Policy-Report-Only`): a política completa,
//    que NÃO bloqueia nada — o navegador apenas manda cada violação pra
//    /api/csp-report, que registra uma linha por violação distinta no log do
//    servidor (ver app/api/csp-report/route.ts). Depois de um período de uso
//    real sem violação inesperada, é só trocar o nome do header pra
//    `Content-Security-Policy` (ou promover diretiva por diretiva).
//
// Limite conhecido: `script-src` tem 'unsafe-inline' porque o Next injeta
// scripts inline (payload RSC/hidratação). Isso ainda barra <script src=
// externo> e fetch/XHR pra domínio de fora (exfiltração), mas NÃO barra script
// inline injetado. Fechar isso exige CSP com nonce via proxy.ts + renderização
// dinâmica de TODAS as páginas (ver node_modules/next/dist/docs/01-app/02-guides/
// content-security-policy.md) — projeto à parte, não vale arriscar sem ambiente
// de teste.
const isDev = process.env.NODE_ENV === "development";

const CSP_ENFORCED = ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'"].join("; ");

const CSP_REPORT_ONLY = [
  "default-src 'self'",
  // connect.facebook.net = SDK do Facebook (login do WhatsApp Cloud, ver
  // components/whatsapp-connect.tsx). 'unsafe-eval' só no dev (React).
  `script-src 'self' 'unsafe-inline' https://connect.facebook.net${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // https: amplo em imagem/mídia de propósito: URLs assinadas do R2 e foto de
  // perfil do WhatsApp vêm de hosts que variam por conta/CDN. Imagem não
  // executa código — o que importa fechar é script/connect/frame/object.
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  // Upload de arquivo passa pela API do próprio app (não vai direto pro R2 do
  // navegador), então o navegador só fala com a própria origem + Facebook.
  "connect-src 'self' https://*.facebook.com https://connect.facebook.net",
  "frame-src 'self' https://*.facebook.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "form-action 'self'",
  "report-uri /api/csp-report",
].join("; ");

// Permissions-Policy: desliga APIs de navegador que o app não usa. Microfone
// fica liberado só pra própria origem (gravação de áudio do composer do
// WhatsApp e ditado por voz). Câmera, localização, pagamento, USB e captura de
// tela nunca são usados — se um script injetado tentar, o navegador nega.
const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=(self)",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "display-capture=()",
  "browsing-topics=()",
].join(", ");

async function headers() {
  return [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
        { key: "Content-Security-Policy", value: CSP_ENFORCED },
        { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
      ],
    },
  ];
}

const nextConfig: NextConfig = {
  output: "standalone",
  // Some o `x-powered-by: Next.js` (relatório de QA, B6) — divulgação de tecnologia sem nenhum uso.
  poweredByHeader: false,
  headers,
  // "exceljs" fora do bundle do Turbopack, de propósito — ele SEMPRE embute
  // a dependência direto nos próprios chunks internos (confirmado num build
  // de verificação: nenhuma cópia separada sobra em .next/standalone/
  // node_modules mesmo com um `import` estático de verdade em cima). Isso é
  // exatamente o problema pro isolamento de segurança da importação de
  // planilha (ver lib/parse-spreadsheet.ts) — lib/parse-spreadsheet-worker.ts
  // roda como worker_thread carregado pelo Node PURO (fora do runtime do
  // Turbopack, precisamente pra isolar um V8 Isolate próprio das duas CVEs
  // do ExcelJS 4.4.0), e o Node só acha "exceljs" via node_modules de
  // verdade no disco. serverExternalPackages força o rastreador do Next
  // (.next/standalone) a copiar o pacote real (e o que ele depende) em vez
  // de embuti-lo, exatamente o que o worker precisa.
  serverExternalPackages: ["exceljs"],
  // Sem isso, o Next (a partir da v15) trata toda página dinâmica como
  // "stale" em 0 segundos — ou seja, voltar pra uma tela que você acabou de
  // visitar refaz a busca no servidor do zero e reexibe o esqueleto de
  // carregamento, mesmo sem nada ter mudado. Isso mantém o payload de cada
  // rota já visitada em cache no navegador por um tempo curto — navegar
  // entre Agenda/Clientes/Pipeline/etc. continua rápido logo depois da 1ª
  // visita. Ações que alteram dado (mover negócio, criar contato, ...)
  // continuam atualizando na hora porque toda mutação chama
  // router.refresh(), que ignora esse cache. O que pode ficar "atrasado" é
  // só a mudança feita por OUTRO usuário numa tela que você não recarregou.
  //
  // Era 3600 (1h) — baixado pra 30s: com ~20 consultores editando dado
  // compartilhado (times, grupos de compartilhamento, negócios
  // reatribuídos) ao mesmo tempo, 1h de cache client-side fazia qualquer
  // mudança de outra pessoa demorar até 1h pra aparecer pra quem não
  // recarregasse a tela — relatado como "dado errado"/"não é meu". 30s
  // ainda evita o esqueleto de carregamento em navegação rápida de ida-e-
  // volta, sem deixar dado de outra pessoa parado por tanto tempo.
  experimental: {
    staleTimes: {
      dynamic: 30,
    },
  },
};

export default nextConfig;
