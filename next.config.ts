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
  // Sem isso, o Next (a partir da v15) trata toda página dinâmica como
  // "stale" em 0 segundos — ou seja, voltar pra uma tela que você acabou de
  // visitar refaz a busca no servidor do zero e reexibe o esqueleto de
  // carregamento, mesmo sem nada ter mudado. Isso mantém o payload de cada
  // rota já visitada em cache no navegador por 1h — navegar entre
  // Agenda/Clientes/Pipeline/etc. fica instantâneo depois da 1ª visita.
  // Ações que alteram dado (mover negócio, criar contato, ...) continuam
  // atualizando na hora porque toda mutação chama router.refresh(), que
  // ignora esse cache. O que pode ficar "atrasado" é só a mudança feita por
  // OUTRO usuário numa tela que você não recarregou — só aparece quando
  // esse cache expirar ou quando alguma ação sua disparar um refresh.
  experimental: {
    staleTimes: {
      dynamic: 3600,
    },
  },
};

export default nextConfig;
