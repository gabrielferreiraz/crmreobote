/**
 * Registro das logos parceiras exibidas no cartão (pedido explícito do
 * Diretor Comercial: Reobote, Rodobens, Yamaha, Servopa, nessa ordem) —
 * centralizado aqui em vez de espalhado pelo componente, pra dar pra
 * reordenar/ligar-desligar/adicionar outra logo no futuro editando só esta
 * lista (ver components/digital-card/digital-card-logos.tsx, que só
 * itera sobre isto).
 *
 * `src: null` = arquivo ainda não existe no projeto — o componente pula a
 * logo (nunca quebra o layout nem inventa um placeholder falso). Reobote é
 * a exceção: já existe como SVG inline (components/reobote-logo.tsx, mesmo
 * motivo documentado lá — <img src> falhando em navegadores embutidos), o
 * componente de logos reconhece `component: "reobote"` e renderiza aquele
 * componente em vez de um <img>.
 *
 * Rodobens/Yamaha/Servopa: arquivos em public/partner-logos/ (não soltos na
 * raiz de public/ — o proxy (ver proxy.ts + PUBLIC_PATHS em
 * lib/auth.config.ts) exige sessão pra qualquer caminho fora da lista
 * pública, e a raiz de public/ não está nela. A página do cartão em si
 * (/c/[slug]) é pública, mas o <img src="/logo-rodobens.svg"> era uma
 * requisição À PARTE, pro caminho "/logo-rodobens.svg" — sem sessão, o
 * proxy redirecionava ESSA requisição pro /login antes de chegar no
 * arquivo estático, então a logo nunca carregava pra quem via o cartão
 * deslogado (exatamente todo mundo que não é o próprio consultor). Um
 * prefixo próprio (`/partner-logos/`) liberado em PUBLIC_PATHS resolve de
 * uma vez pra essas 3 + qualquer logo nova que entrar aqui depois, sem
 * precisar mexer no proxy de novo.
 */
export type PartnerLogo = {
  key: string;
  label: string;
  active: boolean;
  order: number;
  /** "reobote" = usa o componente SVG inline; caminho = usa <img src>; null = vetor/placeholder de texto de fallback. */
  src: string | "reobote" | null;
};

export const AVAILABLE_PARTNER_LOGOS: PartnerLogo[] = [
  { key: "reobote", label: "Reobote", active: true, order: 1, src: "reobote" },
  { key: "rodobens", label: "Rodobens", active: true, order: 2, src: "/partner-logos/rodobens.svg" },
  { key: "yamaha", label: "Yamaha", active: true, order: 3, src: "/partner-logos/yamaha.svg" },
  { key: "servopa", label: "Servopa", active: true, order: 4, src: "/partner-logos/servopa.svg" },
];

export const DEFAULT_SELECTED_LOGOS = ["reobote", "rodobens", "yamaha", "servopa"];

export function getActivePartnerLogos(customKeys?: string[]): PartnerLogo[] {
  const keys = customKeys && customKeys.length > 0 ? customKeys : DEFAULT_SELECTED_LOGOS;
  const logoMap = new Map(AVAILABLE_PARTNER_LOGOS.map((l) => [l.key, l]));
  
  const resolved: PartnerLogo[] = [];
  keys.forEach((key, index) => {
    const found = logoMap.get(key);
    if (found) {
      resolved.push({ ...found, order: index + 1 });
    }
  });

  return resolved;
}
