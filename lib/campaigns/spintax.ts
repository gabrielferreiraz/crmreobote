/**
 * Variação de script pra campanha de prospecção — mesma sintaxe spintax
 * usada no senderwhats (`{[opção 1|opção 2|opção 3]}`), portada aqui como
 * função pura. Evita mandar a mesma frase exata pra centenas de contatos,
 * o que é um padrão fácil de reconhecer como disparo automático.
 */
// O corpo de cada opção pode conter tokens de variável de chave simples
// (ex.: "Oi {primeiro_nome}!") — só "[" e "]" ficam de fora, já que esses
// dois são os únicos caracteres que de fato delimitam o bloco de variação
// em si. Sem isso, uma opção com "{cargo}" dentro nunca era reconhecida
// como variação (a chave "quebrava" o match) e ia pro envio sem expandir.
export function expandSpintax(text: string): string {
  return text.replace(/\{\[([^[\]]+)\]\}/g, (_, options: string) => {
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
  empresa?: string | null;
  cidade?: string | null;
  // Nome do responsável pelo contato (owner do negócio, no envio em massa do
  // Pipeline; senão o responsável cadastrado no Contact) — ver buildVariables
  // em lib/campaigns/engine.ts.
  consultor?: string | null;
};

/**
 * Substitui `{nome}`, `{primeiro_nome}`, `{cargo}`, `{empresa}`, `{cidade}`,
 * `{consultor}` e `{saudacao}` (bom dia/boa tarde/boa noite, já no fuso
 * certo — ver lib/timezone.ts) no texto, depois de expandir o spintax.
 */
export function renderTemplate(template: string, vars: CampaignVariables, greeting: string): string {
  const expanded = expandSpintax(template);
  return expanded
    .replaceAll("{nome}", vars.nome)
    .replaceAll("{primeiro_nome}", firstName(vars.nome))
    .replaceAll("{cargo}", vars.cargo ?? "")
    .replaceAll("{empresa}", vars.empresa ?? "")
    .replaceAll("{cidade}", vars.cidade ?? "")
    .replaceAll("{consultor}", vars.consultor ?? "")
    .replaceAll("{saudacao}", greeting);
}

/** Uma "mensagem" da sequência de um script — delayAfterSec é a espera até a PRÓXIMA (ignorado na última). */
export type ScriptStep = { text: string; delayAfterSec: number };

/** Aplica renderTemplate em cada mensagem da sequência, preservando o delay configurado. */
export function renderSteps(steps: ScriptStep[], vars: CampaignVariables, greeting: string): ScriptStep[] {
  return steps.map((step) => ({ text: renderTemplate(step.text, vars, greeting), delayAfterSec: step.delayAfterSec }));
}

/** Uma variante de script dentro de uma campanha — sorteada por peso (ver pickWeighted). */
export type WeightedScript = { steps: ScriptStep[]; weight: number; scriptId?: string };

/** Sorteia um item proporcional ao peso configurado — genérico pra servir tanto scripts de campanha quanto qualquer outra lista com peso. */
export function pickWeighted<T extends { weight: number }>(items: T[]): T {
  const totalWeight = items.reduce((sum, t) => sum + Math.max(0, t.weight), 0);
  if (totalWeight <= 0) return items[0];

  let roll = Math.random() * totalWeight;
  for (const item of items) {
    roll -= Math.max(0, item.weight);
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}
