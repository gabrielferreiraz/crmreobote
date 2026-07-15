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
};

export default nextConfig;
