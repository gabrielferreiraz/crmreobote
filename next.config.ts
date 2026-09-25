import type { NextConfig } from "next";

// Headers de baixo risco (não dependem de saber todo domínio externo/script
// inline que o app usa, então não derrubam nada) — de propósito NÃO inclui
// Content-Security-Policy aqui: uma CSP errada quebra a aplicação inteira em
// produção (imagens do R2, upload, gravação de áudio do composer de
// WhatsApp) e isso não dá pra validar sem um ambiente rodando. Ver memória
// do projeto antes de adicionar CSP.
async function headers() {
  return [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      ],
    },
  ];
}

const nextConfig: NextConfig = {
  output: "standalone",
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
