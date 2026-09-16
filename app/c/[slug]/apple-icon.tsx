import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Ícone específico do atalho "Cartão de visita" — só desta rota (app/c/
 * [slug]/), nunca o "C" indigo do CRM (ver app/apple-icon.tsx na raiz).
 * `icon`/`apple-icon` podem ser aninhados em qualquer segmento de rota
 * (diferente de `manifest.ts`, que só existe na raiz do app — ver
 * comentário em page.tsx sobre o bug do atalho caindo no Início), então dá
 * pra ter um ícone próprio aqui sem precisar de manifesto nenhum. Pedido
 * explícito do usuário: "não é PWA, é só atalho" — só nome (title, ver
 * page.tsx) e ícone.
 *
 * Mesmo glifo do ícone IdCard (lucide-react), já usado em
 * components/user-menu.tsx pro item "Cartão de visita" do menu — path data
 * copiado direto de
 * node_modules/lucide-react/dist/esm/icons/id-card.mjs em vez de importar
 * o pacote inteiro dentro de um Route Handler de imagem (satori/next/og
 * renderiza um subconjunto de SVG bruto, sem precisar do componente React
 * do lucide). Cor de marca do CARTÃO (#00aeee, mesma do
 * reobote-logo.tsx/digital-card-view.tsx), não o indigo do CRM — o
 * consultor precisa reconhecer de relance que é um ícone diferente do CRM
 * na tela inicial do celular.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#00aeee",
        }}
      >
        <svg
          width="112"
          height="112"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <circle cx="9" cy="11" r="2" />
          <path d="M6.17 15a3 3 0 0 1 5.66 0" />
          <path d="M16 10h2" />
          <path d="M16 14h2" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
