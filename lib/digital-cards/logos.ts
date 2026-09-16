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
 * Rodobens/Yamaha/Servopa: arquivo de logo real ainda não chegou — quando
 * chegar, sobe em public/logos/<arquivo> e troca `src: null` pelo caminho.
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
  { key: "rodobens", label: "Rodobens", active: true, order: 2, src: "/logo-rodobens.svg" },
  { key: "yamaha", label: "Yamaha", active: true, order: 3, src: "/logo-yamaha.svg" },
  { key: "servopa", label: "Servopa", active: true, order: 4, src: "/logo-servopa.svg" },
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
