/**
 * Variação de script pra campanha de prospecção — mesma sintaxe spintax
 * usada no senderwhats (`{[opção 1|opção 2|opção 3]}`), portada aqui como
 * função pura. Evita mandar a mesma frase exata pra centenas de contatos,
 * o que é um padrão fácil de reconhecer como disparo automático.
 */
export function expandSpintax(text: string): string {
  return text.replace(/\{\[([^{}]+)\]\}/g, (_, options: string) => {
    const choices = options.split("|");
    return choices[Math.floor(Math.random() * choices.length)];
  });
}

/** Primeiro nome — "Maria Silva Santos" → "Maria". */
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

export type CampaignVariables = {
  nome: string;
  cargo?: string | null;
};

/**
 * Substitui `{nome}`, `{primeiro_nome}`, `{cargo}` e `{saudacao}` (bom
 * dia/boa tarde/boa noite, já no fuso certo — ver lib/timezone.ts) no texto,
 * depois de expandir o spintax.
 */
export function renderTemplate(template: string, vars: CampaignVariables, greeting: string): string {
  const expanded = expandSpintax(template);
  return expanded
    .replaceAll("{nome}", vars.nome)
    .replaceAll("{primeiro_nome}", firstName(vars.nome))
    .replaceAll("{cargo}", vars.cargo ?? "")
    .replaceAll("{saudacao}", greeting);
}

export type WeightedTemplate = { text: string; weight: number };

/** Sorteia uma variante de mensagem proporcional ao peso configurado. */
export function pickWeightedTemplate(templates: WeightedTemplate[]): WeightedTemplate {
  const totalWeight = templates.reduce((sum, t) => sum + Math.max(0, t.weight), 0);
  if (totalWeight <= 0) return templates[0];

  let roll = Math.random() * totalWeight;
  for (const template of templates) {
    roll -= Math.max(0, template.weight);
    if (roll <= 0) return template;
  }
  return templates[templates.length - 1];
}
