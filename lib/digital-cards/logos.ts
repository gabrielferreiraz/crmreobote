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
  /** "reobote" = usa o componente SVG inline; caminho = usa <img src>; null = ainda não temos o arquivo. */
  src: string | "reobote" | null;
};

export const PARTNER_LOGOS: PartnerLogo[] = [
  { key: "reobote", label: "Reobote", active: true, order: 1, src: "reobote" },
  { key: "rodobens", label: "Rodobens", active: true, order: 2, src: null },
  { key: "yamaha", label: "Yamaha", active: true, order: 3, src: null },
  { key: "servopa", label: "Servopa", active: true, order: 4, src: null },
];

export function getActivePartnerLogos(): PartnerLogo[] {
  return PARTNER_LOGOS.filter((logo) => logo.active).sort((a, b) => a.order - b.order);
}
